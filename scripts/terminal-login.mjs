import process from 'node:process'
import jpeg from 'jpeg-js'
import fs from 'node:fs/promises'

const APP_IDS = {
  production: 'wx9d11056dd75b7240',
  test: 'wx3dd49afb7e2cf957'
}

const REDIRECT_URIS = {
  production: 'https://security.guanjia.qq.com/login',
  test: 'https://security-test.guanjia.qq.com/login'
}

const WEB_VERSION = '1.4.0'
const DEFAULT_LOGIN_KEY = 'm83qdao0AmE5'

function parseArgs(argv) {
  const args = {
    env: 'production',
    guid: '',
    state: '',
    pollIntervalMs: 1500,
    timeoutMs: 180000,
    quiet: false,
    resultFile: '',
    help: false
  }

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') args.help = true
    else if (arg === '--env') args.env = argv[++i]
    else if (arg === '--guid') args.guid = argv[++i]
    else if (arg === '--state') args.state = argv[++i]
    else if (arg === '--poll-interval') args.pollIntervalMs = Number(argv[++i])
    else if (arg === '--timeout') args.timeoutMs = Number(argv[++i])
    else if (arg === '--quiet') args.quiet = true
    else if (arg === '--result-file') args.resultFile = argv[++i]
    else throw new Error(`Unknown argument: ${arg}`)
  }

  return args
}

function printHelp() {
  console.log(`Usage:
  node scripts/terminal-login.mjs [--env production|test] [--guid GUID] [--quiet] [--result-file FILE]

这个脚本会：
  1. 获取微信登录 state
  2. 直接在终端渲染二维码
  3. 轮询扫码状态直到拿到登录 code
  4. 用 code 换取 jwt_token / openclaw_channel_token
`)
}

function randomGuid() {
  return `${Date.now()}${Math.random().toString(16).slice(2, 12)}`
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options)
  const text = await response.text()
  const data = text ? JSON.parse(text) : null
  return { response, data }
}

async function getWxLoginState({ env, guid }) {
  const { data } = await requestJson('https://jprx.m.qq.com/data/4050/forward', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Version': '1',
      'X-Token': DEFAULT_LOGIN_KEY,
      'X-Guid': guid,
      'X-Account': '1',
      'X-Session': ''
    },
    body: JSON.stringify({ guid, web_version: WEB_VERSION, web_env: 'release' })
  })

  const state = data?.data?.resp?.data?.state || data?.data?.state || ''
  if (!state) {
    throw new Error('获取微信登录 state 失败')
  }
  return state
}

async function fetchQrPage({ env, state }) {
  const pageUrl = new URL('https://open.weixin.qq.com/connect/qrconnect')
  pageUrl.searchParams.set('appid', APP_IDS[env])
  pageUrl.searchParams.set('scope', 'snsapi_login')
  pageUrl.searchParams.set('redirect_uri', REDIRECT_URIS[env])
  pageUrl.searchParams.set('state', state)
  pageUrl.searchParams.set('login_type', 'jssdk')
  pageUrl.searchParams.set('self_redirect', 'true')
  pageUrl.searchParams.set('style', 'black')

  const response = await fetch(pageUrl)
  const html = await response.text()
  const scriptMatch = html.match(/https:\/\/lp\.open\.weixin\.qq\.com\/connect\/l\/qrconnect\?uuid=([A-Za-z0-9_-]+)/)
    || html.match(/https:\/\/lp\.open\.weixin\.qq\.com\/connect\/l\/qrconnect\?uuid=([A-Za-z0-9_-]+)/)
    || html.match(/lp\.open\.weixin\.qq\.com\/connect\/l\/qrconnect\?uuid=([A-Za-z0-9_-]+)/)
    || html.match(/uuid=([A-Za-z0-9_-]{10,})/)
  const imgMatch = html.match(/https:\/\/open\.weixin\.qq\.com\/connect\/qrcode\/([A-Za-z0-9_-]+)/)
    || html.match(/open\.weixin\.qq\.com\/connect\/qrcode\/([A-Za-z0-9_-]+)/)
  const uuid = scriptMatch?.[1] || imgMatch?.[1] || ''
  const imageUrl = uuid ? `https://open.weixin.qq.com/connect/qrcode/${uuid}` : ''
  if (!(uuid && imageUrl)) {
    throw new Error('提取微信二维码 uuid / 图片地址失败')
  }
  return { uuid, imageUrl }
}

function getDarkBounds(image) {
  let minX = image.width
  let maxX = 0
  let minY = image.height
  let maxY = 0

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const idx = (image.width * y + x) * 4
      const r = image.data[idx]
      const g = image.data[idx + 1]
      const b = image.data[idx + 2]
      if (r < 128 && g < 128 && b < 128) {
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
  const candidates = []
  for (let size = 4; size <= 20; size += 1) {
    const modules = width / size
    if (Number.isInteger(modules) && modules >= 21 && modules <= 61) {
      candidates.push({ size, modules })
    }
  }
  return candidates[0]?.size || 10
}

function renderTerminalQr(jpegData) {
  const bounds = getDarkBounds(jpegData)
  const moduleSize = detectModuleSize(bounds)
  const modulesX = Math.round((bounds.maxX - bounds.minX + 1) / moduleSize)
  const modulesY = Math.round((bounds.maxY - bounds.minY + 1) / moduleSize)
  const matrix = []

  for (let my = 0; my < modulesY; my += 1) {
    const row = []
    for (let mx = 0; mx < modulesX; mx += 1) {
      const sampleX = Math.min(jpegData.width - 1, bounds.minX + mx * moduleSize + Math.floor(moduleSize / 2))
      const sampleY = Math.min(jpegData.height - 1, bounds.minY + my * moduleSize + Math.floor(moduleSize / 2))
      const idx = (jpegData.width * sampleY + sampleX) * 4
      const r = jpegData.data[idx]
      const g = jpegData.data[idx + 1]
      const b = jpegData.data[idx + 2]
      row.push(r < 128 && g < 128 && b < 128)
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
    lines.push(blank.repeat(quiet) + row.map((cell) => (cell ? dark : blank)).join('') + blank.repeat(quiet))
  }
  lines.push(blank.repeat(paddedWidth))
  return lines.join('\n')
}

async function fetchQrImage(imageUrl) {
  const response = await fetch(imageUrl)
  const buffer = Buffer.from(await response.arrayBuffer())
  return jpeg.decode(buffer, { useTArray: true })
}

function parseWxStatus(scriptText) {
  const errcodeMatch = scriptText.match(/wx_errcode=(\d+)/)
  const codeMatch = scriptText.match(/wx_code='([^']*)'/)
  return {
    errcode: Number(errcodeMatch?.[1] || 0),
    code: codeMatch?.[1] || ''
  }
}

async function pollWxCode({ uuid, pollIntervalMs, timeoutMs, quiet }) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const response = await fetch(`https://lp.open.weixin.qq.com/connect/l/qrconnect?uuid=${uuid}`)
    const text = await response.text()
    const status = parseWxStatus(text)

    if (status.code) {
      return status.code
    }
    if (status.errcode === 404) {
      if (!quiet) process.stdout.write('\r[微信登录] 已扫码，请在手机上确认...                          ')
    } else if (status.errcode === 408) {
      if (!quiet) process.stdout.write('\r[微信登录] 等待扫码...                                         ')
    } else if (status.errcode === 403) {
      throw new Error('手机端已拒绝本次登录')
    } else if (status.errcode === 402) {
      throw new Error('二维码已过期，请重新执行登录')
    } else if (status.errcode) {
      if (!quiet) process.stdout.write(`\r[微信登录] 当前状态 ${status.errcode}...                              `)
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
  }

  throw new Error('等待微信确认超时')
}

async function exchangeWxCode({ guid, state, code }) {
  const { data } = await requestJson('https://jprx.m.qq.com/data/4026/forward', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Version': '1',
      'X-Token': DEFAULT_LOGIN_KEY,
      'X-Guid': guid,
      'X-Account': '1',
      'X-Session': ''
    },
    body: JSON.stringify({ guid, code, state, web_version: WEB_VERSION, web_env: 'release' })
  })
  return data?.data?.resp?.data || data?.data?.data || data?.data || data
}

async function main() {
  const args = parseArgs(process.argv)
  if (args.help) {
    printHelp()
    return
  }

  args.guid = args.guid || randomGuid()
  const state = args.state || await getWxLoginState({ env: args.env, guid: args.guid })
  const { uuid, imageUrl } = await fetchQrPage({ env: args.env, state })
  const image = await fetchQrImage(imageUrl)

  if (!args.quiet) {
    console.log('[微信登录] 请使用微信扫描下面的二维码：\n')
    console.log(renderTerminalQr(image))
    console.log(`\n[微信登录] guid=${args.guid}`)
  }

  const code = await pollWxCode({ uuid, pollIntervalMs: args.pollIntervalMs, timeoutMs: args.timeoutMs, quiet: args.quiet })
  if (!args.quiet) {
    process.stdout.write('\n')
    console.log('[微信登录] 已确认登录，正在换取 token...')
  }
  const payload = await exchangeWxCode({ guid: args.guid, state, code })
  const output = { guid: args.guid, state, code, result: payload }
  if (args.resultFile) {
    await fs.writeFile(args.resultFile, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
  }
  console.log(JSON.stringify(output, null, 2))
}

main().catch((error) => {
  console.error(`\n[微信登录] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
