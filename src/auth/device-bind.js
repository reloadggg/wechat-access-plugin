import { nested } from './utils.js'

const DEFAULT_OPEN_KFID = 'wkzLlJLAAAfbxEV3ZcS-lHZxkaKmpejQ'
const POLL_INTERVAL_MS = 2000
const DEFAULT_TIMEOUT_MS = 300_000

async function defaultShowQr(url) {
  try {
    const qrterm = await import('qrcode-terminal')
    const generate = qrterm.default?.generate ?? qrterm.generate
    generate(url, { small: true }, (qrcode) => {
      console.log(qrcode)
    })
  } catch {
    // qrcode-terminal not available
  }
}

export async function performDeviceBinding(options) {
  const {
    api,
    openKfId = DEFAULT_OPEN_KFID,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    log = { info: console.log, warn: console.warn, error: console.error },
    showQr = defaultShowQr,
  } = options

  log.info('[device-bind] 生成企微客服链接...')
  let linkResult
  try {
    linkResult = await api.generateContactLink(openKfId)
  } catch (e) {
    const msg = `生成客服链接失败: ${e instanceof Error ? e.message : String(e)}`
    log.warn(`[device-bind] ${msg}`)
    return { success: false, message: msg }
  }

  if (!linkResult.success) {
    const msg = `生成客服链接失败: ${linkResult.message ?? '未知错误'}`
    log.warn(`[device-bind] ${msg}`)
    return { success: false, message: msg }
  }

  const linkData = linkResult.data
  const contactUrl =
    nested(linkData, 'url') ||
    nested(linkData, 'data', 'url') ||
    nested(linkData, 'resp', 'url') ||
    ''

  if (!contactUrl) {
    const msg = '服务端未返回客服链接 URL'
    log.warn(`[device-bind] ${msg}`)
    return { success: false, message: msg }
  }

  console.log('')
  console.log('='.repeat(64))
  console.log('请用「控制端微信」打开下方链接，完成设备绑定')
  console.log('绑定后微信中会出现对话入口')
  console.log('='.repeat(64))
  await showQr(contactUrl)
  console.log(`\n链接: ${contactUrl}\n`)

  log.info('[device-bind] 等待设备绑定...')
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
    try {
      const status = await api.queryDeviceByGuid()
      if (status.success) {
        const sd = status.data
        const nickname = nested(sd, 'nickname') || nested(sd, 'data', 'nickname')
        const externalUserId = nested(sd, 'external_user_id') || nested(sd, 'data', 'external_user_id')

        if (nickname || externalUserId) {
          const msg = `设备绑定成功!${nickname ? ` 微信昵称: ${nickname}` : ''}`
          log.info(`[device-bind] ${msg}`)
          return { success: true, contactUrl, nickname: nickname || undefined, message: msg }
        }
      }
    } catch {
      // polling failure is non-fatal
    }
  }

  return {
    success: false,
    contactUrl,
    message: '设备绑定超时。请确认已在微信中打开上方链接，然后重启 Gateway 重试。',
  }
}
