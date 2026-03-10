/**
 * 新版登录脚本 — 使用 auth 模块完成完整流程
 * 运行: node scripts/login-new.mjs
 *
 * 流程: OAuth 扫码 → 获取 jwt_token + channel_token → 设备绑定 → 保存完整 auth state
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { getDeviceGuid, getEnvironment, performLogin, saveState } from '../src/auth/index.js'

const CHANNEL_ID = 'openclaw-wechat-access-plugin'

function resolveOpenClawConfigPath() {
  if (process.env.OPENCLAW_CONFIG) return path.resolve(process.env.OPENCLAW_CONFIG)
  if (process.env.OPENCLAW_HOME) return path.join(path.resolve(process.env.OPENCLAW_HOME), 'openclaw.json')
  return path.join(process.env.USERPROFILE || process.env.HOME || '.', '.openclaw', 'openclaw.json')
}

async function main() {
  const envName = process.argv.includes('--test') ? 'test' : 'production'
  const bypassInvite = process.argv.includes('--bypass-invite')

  const env = getEnvironment(envName)
  const guid = getDeviceGuid()

  console.log(`[login] 环境: ${envName}`)
  console.log(`[login] 设备 GUID: ${guid}`)
  console.log(`[login] 跳过邀请码: ${bypassInvite}`)
  console.log()

  // 完整登录流程（含设备绑定）
  const credentials = await performLogin({ guid, env, bypassInvite })

  console.log()
  console.log('[login] jwt_token:', credentials.jwtToken ? credentials.jwtToken.slice(0, 8) + '...' : '(空)')
  console.log('[login] channel_token:', credentials.channelToken ? credentials.channelToken.slice(0, 8) + '...' : '(空)')
  console.log('[login] userId:', credentials.userInfo?.user_id ?? '(空)')
  console.log('[login] guid:', credentials.guid)

  // 更新 openclaw.json
  const configPath = resolveOpenClawConfigPath()
  try {
    const raw = await fs.readFile(configPath, 'utf8')
    const config = JSON.parse(raw)
    config.channels ||= {}
    config.channels[CHANNEL_ID] = {
      ...(config.channels[CHANNEL_ID] || {}),
      enabled: true,
      token: credentials.channelToken,
      wsUrl: env.wechatWsUrl,
      guid: credentials.guid,
      userId: String(credentials.userInfo?.user_id ?? ''),
      bypassInvite
    }
    // 只有在 qclaw provider 已存在时才更新 apiKey
    if (credentials.apiKey && config.models?.providers?.qclaw) {
      config.models.providers.qclaw.apiKey = credentials.apiKey
    }
    await fs.writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8')
    console.log(`[login] openclaw.json 已更新: ${configPath}`)
  } catch (err) {
    console.warn(`[login] 更新 openclaw.json 失败 (非致命): ${err.message}`)
  }

  console.log()
  console.log('='.repeat(64))
  console.log('登录完成! jwt_token 和 channel_token 已保存。')
  console.log('下次 gateway 启动时会自动刷新 token。')
  console.log('请运行 openclaw gateway restart 生效。')
  console.log('='.repeat(64))
}

main().catch((err) => {
  console.error(`[login] 失败: ${err.message}`)
  process.exit(1)
})
