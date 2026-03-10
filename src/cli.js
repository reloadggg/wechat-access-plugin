import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { performTerminalLogin, getDeviceGuid, getEnvironment, clearState } from './auth/index.js'

const CHANNEL_ID = 'openclaw-wechat-access-plugin'

function resolveOpenClawConfigPath() {
  if (process.env.OPENCLAW_CONFIG) return path.resolve(process.env.OPENCLAW_CONFIG)
  if (process.env.OPENCLAW_HOME) return path.join(path.resolve(process.env.OPENCLAW_HOME), 'openclaw.json')
  const home = process.env.USERPROFILE || process.env.HOME || '.'
  return path.join(home, '.openclaw', 'openclaw.json')
}

function updateOpenClawConfig(credentials, env) {
  try {
    const configPath = resolveOpenClawConfigPath()
    const raw = fs.readFileSync(configPath, 'utf8')
    const cfg = JSON.parse(raw)
    cfg.channels ||= {}
    cfg.channels[CHANNEL_ID] = {
      ...(cfg.channels[CHANNEL_ID] || {}),
      enabled: true,
      token: credentials.channelToken,
      wsUrl: env.wechatWsUrl,
      guid: credentials.guid,
      userId: String(credentials.userInfo?.user_id ?? ''),
    }
    // 只有在 qclaw provider 已存在时才更新 apiKey，避免写入不完整的 provider
    if (credentials.apiKey && cfg.models?.providers?.qclaw) {
      cfg.models.providers.qclaw.apiKey = credentials.apiKey
    }
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2) + '\n', 'utf8')
    console.log(`[wechat-access] openclaw.json 已更新`)
  } catch (err) {
    console.warn(`[wechat-access] 更新 openclaw.json 失败 (非致命): ${err.message}`)
  }
}

function runNodeScript(scriptUrl, args = []) {
  return new Promise((resolve, reject) => {
    const scriptPath = fileURLToPath(scriptUrl)
    const child = spawn(process.execPath, [scriptPath, ...args], {
      stdio: 'inherit',
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: process.env,
      shell: false
    })

    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${scriptPath} exited with code ${code}`))
    })
    child.on('error', reject)
  })
}

export function registerWechatAccessCli({ program, logger, config }) {
  const root = program
    .command('wechat-access')
    .description('微信登录与绑定相关命令')

  root
    .command('login')
    .description('终端二维码扫码登录（自动轮询，无需浏览器）')
    .action(async () => {
      const channelCfg = config?.channels?.[CHANNEL_ID] || {}
      const envName = channelCfg.environment ? String(channelCfg.environment) : 'production'
      const bypassInvite = channelCfg.bypassInvite === true
      const authStatePath = channelCfg.authStatePath ? String(channelCfg.authStatePath) : undefined

      const env = getEnvironment(envName)
      const guid = channelCfg.guid || getDeviceGuid()

      try {
        const credentials = await performTerminalLogin({
          guid,
          env,
          bypassInvite,
          authStatePath,
        })
        // 写回 openclaw.json（token + guid + userId）
        updateOpenClawConfig(credentials, env)
        console.log(`\n登录成功! channel_token: ${credentials.channelToken.substring(0, 6)}...`)
        console.log(`jwt_token 已保存到 ~/.openclaw/wechat-access-auth.json`)
        console.log('下次 gateway 启动会自动刷新 token。')
        console.log('请运行 openclaw gateway restart 生效。')
      } catch (err) {
        console.error(`\n登录失败: ${err instanceof Error ? err.message : String(err)}`)
        process.exit(1)
      }
    })

  root
    .command('logout')
    .description('清除已保存的微信登录态')
    .action(() => {
      const channelCfg = config?.channels?.[CHANNEL_ID] || {}
      const authStatePath = channelCfg.authStatePath ? String(channelCfg.authStatePath) : undefined
      clearState(authStatePath)
      console.log('已清除登录态，下次启动将需要重新扫码登录。')
    })

  root
    .command('login-browser')
    .description('浏览器备用登录方案')
    .action(async () => {
      logger.info?.('wechat-access: 启动浏览器登录流程')
      await runNodeScript(new URL('../tools/token-cli/serve.mjs', import.meta.url), ['--apply-config', '--bind'])
    })

  root
    .command('status')
    .description('显示当前渠道状态说明')
    .action(() => {
      console.log([
        '检查建议：',
        '1. openclaw status',
        '2. openclaw logs --follow',
        '3. 若未登录，执行: openclaw wechat-access login',
        '4. 若终端二维码方案不稳定，执行: openclaw wechat-access login-browser'
      ].join('\n'))
    })
}
