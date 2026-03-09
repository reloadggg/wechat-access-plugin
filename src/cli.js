import process from 'node:process'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

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

export function registerWechatAccessCli({ program, logger }) {
  const root = program
    .command('wechat-access')
    .description('微信登录与绑定相关命令')

  root
    .command('login')
    .description('使用终端二维码登录并继续安装绑定流程')
    .action(async () => {
      logger.info?.('wechat-access: 启动终端二维码登录流程')
      await runNodeScript(new URL('../scripts/terminal-setup.mjs', import.meta.url), ['--skip-install'])
    })

  root
    .command('login-browser')
    .description('浏览器备用登录方案')
    .action(async () => {
      logger.info?.('wechat-access: 启动浏览器登录流程')
      await runNodeScript(new URL('../tools/token-cli/serve.mjs', import.meta.url), ['--apply-config', '--bind'])
    })

  root
    .command('qr')
    .description('只显示终端二维码并输出 token JSON')
    .action(async () => {
      logger.info?.('wechat-access: 正在渲染终端二维码')
      await runNodeScript(new URL('../scripts/terminal-login.mjs', import.meta.url))
    })

  root
    .command('status')
    .description('显示当前渠道状态说明')
    .action(() => {
      const cfg = program.optsWithGlobals ? null : null
      void cfg
      logger.info?.('Use `openclaw status` to inspect channel runtime state.')
      // eslint-disable-next-line no-console
      console.log([
        '检查建议：',
        '1. openclaw status',
        '2. openclaw logs --follow',
        '3. 若未登录，执行: openclaw wechat-access login',
        '4. 若终端二维码方案不稳定，执行: openclaw wechat-access login-browser'
      ].join('\n'))
    })
}
