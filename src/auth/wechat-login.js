import { createInterface } from 'node:readline'
import { QClawAPI } from './qclaw-api.js'
import { saveState } from './state-store.js'
import { nested } from './utils.js'
import { performDeviceBinding } from './device-bind.js'

export function buildAuthUrl(state, env) {
  const params = new URLSearchParams({
    appid: env.wxAppId,
    redirect_uri: env.wxLoginRedirectUri,
    response_type: 'code',
    scope: 'snsapi_login',
    state,
  })
  return `https://open.weixin.qq.com/connect/qrconnect?${params.toString()}#wechat_redirect`
}

async function displayQrCode(url) {
  console.log('')
  console.log('='.repeat(64))
  console.log('请用微信扫描下方二维码登录')
  console.log('='.repeat(64))
  try {
    const qrterm = await import('qrcode-terminal')
    const generate = qrterm.default?.generate ?? qrterm.generate
    generate(url, { small: true }, (qrcode) => {
      console.log(qrcode)
    })
  } catch {
    console.log('\n(未安装 qrcode-terminal，无法在终端显示二维码)')
  }
  console.log('')
  console.log('或者在浏览器中打开以下链接：')
  console.log(url)
  console.log('='.repeat(64))
}

function readLine(prompt) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

async function waitForAuthCode() {
  console.log()
  console.log('微信扫码授权后，浏览器会跳转到新页面，地址栏 URL 形如：')
  console.log('https://security.guanjia.qq.com/login?code=0a1B2c...&state=xxx')
  console.log()
  console.log('请复制 code= 后面的值（到 & 之前），或直接粘贴完整 URL。')
  console.log()

  const raw = await readLine('请粘贴 code 值或完整 URL: ')
  if (!raw) return ''

  const cleaned = raw.replace(/\\([?=&#])/g, '$1')

  if (cleaned.includes('code=')) {
    try {
      const url = new URL(cleaned)
      const code = url.searchParams.get('code')
      if (code) return code
      if (url.hash) {
        const fragmentParams = new URLSearchParams(url.hash.replace(/^#/, ''))
        const fCode = fragmentParams.get('code')
        if (fCode) return fCode
      }
    } catch {
      // URL parse failed
    }
    const match = cleaned.match(/[?&#]code=([^&#]+)/)
    if (match?.[1]) return match[1]
  }

  return cleaned
}

export async function performLogin(options) {
  const { guid, env, bypassInvite = false, authStatePath, log } = options
  const info = (...args) => log?.info?.(...args) ?? console.log(...args)
  const warn = (...args) => log?.warn?.(...args) ?? console.warn(...args)

  const api = new QClawAPI(env, guid)

  info('[Login] 步骤 1/5: 获取登录 state...')
  let state = String(Math.floor(Math.random() * 10000))
  const stateResult = await api.getWxLoginState()
  if (stateResult.success) {
    const s = nested(stateResult.data, 'state')
    if (s) state = s
  }
  info(`[Login] state=${state}`)

  info('[Login] 步骤 2/5: 生成微信登录二维码...')
  const authUrl = buildAuthUrl(state, env)
  await displayQrCode(authUrl)

  info('[Login] 步骤 3/5: 等待微信扫码授权...')
  const code = await waitForAuthCode()
  if (!code) {
    throw new Error('未获取到授权 code')
  }

  info(`[Login] 步骤 4/5: 用授权码登录 (code=${code.substring(0, 10)}...)`)
  const loginResult = await api.wxLogin(code, state)
  if (!loginResult.success) {
    throw new Error(`登录失败: ${loginResult.message ?? '未知错误'}`)
  }

  const loginData = loginResult.data
  const jwtToken = loginData.token || ''
  const channelToken = loginData.openclaw_channel_token || ''
  const userInfo = loginData.user_info || {}

  api.jwtToken = jwtToken
  api.userId = String(userInfo.user_id ?? '')
  const loginKey = userInfo.loginKey
  if (loginKey) api.loginKey = loginKey

  info(`[Login] 登录成功! 用户: ${userInfo.nickname ?? 'unknown'}`)

  info('[Login] 步骤 5/5: 创建 API Key...')
  let apiKey = ''
  try {
    const keyResult = await api.createApiKey()
    if (keyResult.success) {
      apiKey = nested(keyResult.data, 'key') ?? nested(keyResult.data, 'resp', 'data', 'key') ?? ''
      if (apiKey) info(`[Login] API Key: ${apiKey.substring(0, 8)}...`)
    }
  } catch (e) {
    warn(`[Login] 创建 API Key 失败（非致命）: ${e}`)
  }

  const userId = String(userInfo.user_id ?? '')
  if (userId && !bypassInvite) {
    try {
      const check = await api.checkInviteCode(userId)
      if (check.success) {
        const verified = nested(check.data, 'already_verified')
        if (!verified) {
          info('\n[Login] 需要邀请码验证。')
          const inviteCode = await readLine('请输入邀请码: ')
          if (inviteCode) {
            const submitResult = await api.submitInviteCode(userId, inviteCode)
            if (!submitResult.success) {
              throw new Error(`邀请码验证失败: ${submitResult.message}`)
            }
            info('[Login] 邀请码验证通过!')
          }
        }
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes('邀请码验证失败')) throw e
      warn(`[Login] 邀请码检查失败（非致命）: ${e}`)
    }
  }

  const credentials = { jwtToken, channelToken, userInfo, apiKey, guid }
  saveState({ jwtToken, channelToken, apiKey, guid, userInfo, savedAt: Date.now() }, authStatePath)
  info('[Login] 登录态已保存')

  info('[Login] 开始设备绑定...')
  const bindResult = await performDeviceBinding({
    api,
    log: log ?? { info: console.log, warn: console.warn, error: console.error },
  })
  if (bindResult.success) {
    info(`[Login] ${bindResult.message}`)
  } else {
    warn(`[Login] ${bindResult.message}`)
    warn('[Login] 可稍后重新执行登录命令完成绑定。')
  }

  return credentials
}
