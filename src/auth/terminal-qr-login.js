/**
 * Terminal QR login — 终端二维码自动扫码登录
 *
 * 流程: 获取 state → 渲染终端二维码 → 自动轮询扫码状态 → 换 token → 保存 jwt_token → 设备绑定
 * 不需要用户手动粘贴任何东西，全自动完成。
 */
import jpeg from 'jpeg-js'
import { QClawAPI } from './qclaw-api.js'
import { saveState } from './state-store.js'
import { nested } from './utils.js'
import { performDeviceBinding } from './device-bind.js'

// ====== QR image fetch & terminal rendering (from terminal-login.mjs) ======

function getDarkBounds(image) {
  let minX = image.width, maxX = 0, minY = image.height, maxY = 0
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const idx = (image.width * y + x) * 4
      if (image.data[idx] < 128 && image.data[idx + 1] < 128 && image.data[idx + 2] < 128) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  return { minX, maxX, minY, maxY }
}

function detectModuleSize(bounds) {
  const width = bounds.maxX - bounds.minX + 1
  for (let size = 4; size <= 20; size++) {
    const modules = width / size
    if (Number.isInteger(modules) && modules >= 21 && modules <= 61) return size
  }
  return 10
}

function renderTerminalQr(jpegData) {
  const bounds = getDarkBounds(jpegData)
  const moduleSize = detectModuleSize(bounds)
  const modulesX = Math.round((bounds.maxX - bounds.minX + 1) / moduleSize)
  const modulesY = Math.round((bounds.maxY - bounds.minY + 1) / moduleSize)
  const matrix = []

  for (let my = 0; my < modulesY; my++) {
    const row = []
    for (let mx = 0; mx < modulesX; mx++) {
      const sampleX = Math.min(jpegData.width - 1, bounds.minX + mx * moduleSize + Math.floor(moduleSize / 2))
      const sampleY = Math.min(jpegData.height - 1, bounds.minY + my * moduleSize + Math.floor(moduleSize / 2))
      const idx = (jpegData.width * sampleY + sampleX) * 4
      row.push(jpegData.data[idx] < 128 && jpegData.data[idx + 1] < 128 && jpegData.data[idx + 2] < 128)
    }
    matrix.push(row)
  }

  const quiet = 2
  const blank = '  '
  const dark = '██'
  const lines = []
  const paddedWidth = modulesX + quiet * 2
  lines.push(blank.repeat(paddedWidth))
  for (const row of matrix) {
    lines.push(blank.repeat(quiet) + row.map(c => c ? dark : blank).join('') + blank.repeat(quiet))
  }
  lines.push(blank.repeat(paddedWidth))
  return lines.join('\n')
}

// ====== WeChat OAuth helpers ======

function buildAuthPageUrl(state, env) {
  const params = new URLSearchParams({
    appid: env.wxAppId,
    scope: 'snsapi_login',
    redirect_uri: env.wxLoginRedirectUri,
    state,
    login_type: 'jssdk',
    self_redirect: 'true',
    style: 'black',
  })
  return `https://open.weixin.qq.com/connect/qrconnect?${params.toString()}`
}

async function fetchQrPage(env, state) {
  const pageUrl = buildAuthPageUrl(state, env)
  const response = await fetch(pageUrl)
  const html = await response.text()
  const match =
    html.match(/https:\/\/lp\.open\.weixin\.qq\.com\/connect\/l\/qrconnect\?uuid=([A-Za-z0-9_-]+)/) ||
    html.match(/lp\.open\.weixin\.qq\.com\/connect\/l\/qrconnect\?uuid=([A-Za-z0-9_-]+)/) ||
    html.match(/uuid=([A-Za-z0-9_-]{10,})/)
  const imgMatch =
    html.match(/https:\/\/open\.weixin\.qq\.com\/connect\/qrcode\/([A-Za-z0-9_-]+)/) ||
    html.match(/open\.weixin\.qq\.com\/connect\/qrcode\/([A-Za-z0-9_-]+)/)
  const uuid = match?.[1] || imgMatch?.[1] || ''
  if (!uuid) throw new Error('提取微信二维码 uuid 失败')
  return { uuid, imageUrl: `https://open.weixin.qq.com/connect/qrcode/${uuid}` }
}

async function fetchQrImage(imageUrl) {
  const response = await fetch(imageUrl)
  const buffer = Buffer.from(await response.arrayBuffer())
  return jpeg.decode(buffer, { useTArray: true })
}

function parseWxStatus(text) {
  const errcodeMatch = text.match(/wx_errcode=(\d+)/)
  const codeMatch = text.match(/wx_code='([^']*)'/)
  return { errcode: Number(errcodeMatch?.[1] || 0), code: codeMatch?.[1] || '' }
}

async function pollWxCode({ uuid, pollIntervalMs = 1500, timeoutMs = 180000 }) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const response = await fetch(`https://lp.open.weixin.qq.com/connect/l/qrconnect?uuid=${uuid}`)
    const text = await response.text()
    const status = parseWxStatus(text)

    if (status.code) return status.code
    if (status.errcode === 404) process.stdout.write('\r[登录] 已扫码，请在手机上确认...           ')
    else if (status.errcode === 408) process.stdout.write('\r[登录] 等待扫码...                         ')
    else if (status.errcode === 403) throw new Error('手机端已拒绝本次登录')
    else if (status.errcode === 402) throw new Error('二维码已过期，请重新执行登录')

    await new Promise(r => setTimeout(r, pollIntervalMs))
  }
  throw new Error('等待微信确认超时')
}

// ====== Main login flow ======

/**
 * Terminal QR login — 完整的终端二维码自动登录流程
 *
 * @param {Object} options
 * @param {string} options.guid - Device GUID
 * @param {Object} options.env - Environment config (from getEnvironment)
 * @param {boolean} [options.bypassInvite] - Skip invite code check
 * @param {string} [options.authStatePath] - Custom auth state path
 * @returns {Object} credentials { jwtToken, channelToken, userInfo, apiKey, guid }
 */
export async function performTerminalLogin(options) {
  const { guid, env, bypassInvite = false, authStatePath } = options
  const api = new QClawAPI(env, guid)

  // 1. 获取 OAuth state
  console.log('[登录] 获取登录 state...')
  let state = String(Math.floor(Math.random() * 10000))
  const stateResult = await api.getWxLoginState()
  if (stateResult.success) {
    const s = nested(stateResult.data, 'state')
    if (s) state = s
  }

  // 2. 获取二维码并在终端渲染
  console.log('[登录] 获取微信二维码...')
  const { uuid, imageUrl } = await fetchQrPage(env, state)
  const image = await fetchQrImage(imageUrl)

  console.log('[登录] 请使用微信扫描下面的二维码：\n')
  console.log(renderTerminalQr(image))
  console.log(`\n[登录] guid=${guid}`)

  // 3. 自动轮询扫码状态
  const code = await pollWxCode({ uuid })
  process.stdout.write('\n')
  console.log('[登录] 已确认，正在换取 token...')

  // 4. 用 code 换 token
  const loginResult = await api.wxLogin(code, state)
  if (!loginResult.success) {
    throw new Error(`登录失败: ${loginResult.message ?? '未知错误'}`)
  }

  const loginData = loginResult.data
  const jwtToken = nested(loginData, 'token') || nested(loginData, 'data', 'token') || ''
  const channelToken = nested(loginData, 'openclaw_channel_token') || nested(loginData, 'data', 'openclaw_channel_token') || ''
  const userInfo = nested(loginData, 'user_info') || nested(loginData, 'data', 'user_info') || {}

  api.jwtToken = jwtToken
  api.userId = String(userInfo.user_id ?? '')
  const loginKey = userInfo.loginKey
  if (loginKey) api.loginKey = loginKey

  console.log(`[登录] 登录成功! 用户: ${userInfo.nickname ?? 'unknown'}`)
  console.log(`[登录] jwt_token: ${jwtToken ? jwtToken.slice(0, 8) + '...' : '(空)'}`)
  console.log(`[登录] channel_token: ${channelToken ? channelToken.slice(0, 8) + '...' : '(空)'}`)

  // 5. 创建 API Key（非致命）
  let apiKey = ''
  try {
    const keyResult = await api.createApiKey()
    if (keyResult.success) {
      apiKey = nested(keyResult.data, 'key') ?? nested(keyResult.data, 'resp', 'data', 'key') ?? ''
    }
  } catch { /* non-fatal */ }

  // 6. 邀请码检查
  const userId = String(userInfo.user_id ?? '')
  if (userId && !bypassInvite) {
    try {
      const check = await api.checkInviteCode(userId)
      if (check.success && !nested(check.data, 'already_verified')) {
        console.log('[登录] 需要邀请码验证（可用 bypassInvite: true 跳过）')
      }
    } catch { /* non-fatal */ }
  }

  // 7. 保存 auth state（含 jwt_token！）
  const credentials = { jwtToken, channelToken, userInfo, apiKey, guid }
  saveState({ jwtToken, channelToken, apiKey, guid, userInfo, savedAt: Date.now() }, authStatePath)
  console.log('[登录] jwt_token 已保存到 ~/.openclaw/wechat-access-auth.json')

  // 8. 设备绑定
  console.log('[登录] 开始设备绑定...')
  const bindResult = await performDeviceBinding({
    api,
    log: { info: console.log, warn: console.warn, error: console.error },
  })
  if (bindResult.success) {
    console.log(`[登录] ${bindResult.message}`)
  } else {
    console.warn(`[登录] ${bindResult.message}`)
    console.warn('[登录] 可稍后重新执行登录命令完成绑定。')
  }

  return credentials
}
