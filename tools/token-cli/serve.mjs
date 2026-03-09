import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '..', '..')

function resolveOpenClawConfigPath() {
  if (process.env.OPENCLAW_CONFIG) {
    return path.resolve(process.env.OPENCLAW_CONFIG)
  }
  if (process.env.OPENCLAW_HOME) {
    return path.join(path.resolve(process.env.OPENCLAW_HOME), 'openclaw.json')
  }
  return path.join(process.env.USERPROFILE || process.env.HOME || '.', '.openclaw', 'openclaw.json')
}

const OPENCLAW_CONFIG = resolveOpenClawConfigPath()
const port = Number(process.env.PORT || 43129)
const DEFAULT_WS_URL = 'wss://mmgrcalltoken.3g.qq.com/agentwss'
const WEB_VERSION = '1.4.0'
const MAX_BIND_POLLS = 20
const DEFAULT_LOGIN_KEY = process.env.WECHAT_LOGIN_KEY || 'm83qdao0AmE5'
const DEFAULT_OPEN_ID = process.env.WECHAT_DEFAULT_OPEN_ID || 'wkzLlJLAAAfbxEV3ZcS-lHZxkaKmpejQ'
const BIND_LINK_RETRY_COUNT = 5
const BIND_LINK_RETRY_DELAY_MS = 2000

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8'
}

function parseArgs(argv) {
  return {
    applyConfig: argv.includes('--apply-config'),
    bind: argv.includes('--bind')
  }
}

const options = parseArgs(process.argv)

function openBrowser(url) {
  const command = process.platform === 'win32'
    ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin'
      ? ['open', [url]]
      : ['xdg-open', [url]]

  const child = spawn(command[0], command[1], {
    detached: true,
    stdio: 'ignore'
  })
  child.unref()
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      data += chunk
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function readLocalConfig() {
  const filePath = path.join(PROJECT_ROOT, 'wechat-access.local.json')
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

async function proxyForward(payload) {
  const env = payload.env === 'test' ? 'test' : 'production'
  const baseUrl = env === 'test' ? 'https://jprx.sparta.html5.qq.com/' : 'https://jprx.m.qq.com/'
  const upstream = await fetch(new URL(String(payload.path || ''), baseUrl), {
    method: 'POST',
    headers: payload.headers || {},
    body: JSON.stringify(payload.body || {})
  })
  const renewedToken = upstream.headers.get('X-New-Token') || ''
  const text = await upstream.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  return { upstream, renewedToken, data }
}

function unwrapData(data) {
  return data?.data?.resp?.data ?? data?.data?.data ?? data?.resp?.data ?? data?.data ?? data
}

function normalizeBindLinkPayload(payload) {
  return payload?.resp ?? payload?.data?.resp ?? payload ?? null
}

function normalizeBindStatusPayload(payload) {
  return payload?.resp?.data ?? payload?.data?.resp?.data ?? payload?.data ?? payload?.resp ?? payload ?? null
}

async function requestApi({ env, pathName, body, headers }) {
  const { upstream, renewedToken, data } = await proxyForward({ env, path: pathName, body, headers })
  if (!upstream.ok) {
    throw new Error(upstream.statusText || `HTTP ${upstream.status}`)
  }
  return { renewedToken, data, unwrapped: unwrapData(data) }
}

function buildAuthHeaders({ guid, userId, loginKey, jwtToken }) {
  return {
    'Content-Type': 'application/json',
    'X-Version': '1',
    'X-Token': loginKey,
    'X-Guid': guid,
    'X-Account': String(userId),
    'X-Session': '',
    'X-OpenClaw-Token': jwtToken
  }
}

async function applyWechatConfig({ token, guid, userId, wsUrl = DEFAULT_WS_URL }) {
  const config = JSON.parse(await fs.readFile(OPENCLAW_CONFIG, 'utf8'))
  config.channels ||= {}
  config.channels['openclaw-wechat-access-plugin'] = {
    enabled: true,
    name: 'OpenClaw WeChat Access Plugin',
    token,
    wsUrl,
    guid,
    userId: String(userId)
  }
  config.plugins ||= {}
  config.plugins.allow = Array.isArray(config.plugins.allow) ? config.plugins.allow : []
  if (!config.plugins.allow.includes('openclaw-wechat-access-plugin')) {
    config.plugins.allow.push('openclaw-wechat-access-plugin')
  }
  config.plugins.entries ||= {}
  config.plugins.entries['openclaw-wechat-access-plugin'] = {
    ...(config.plugins.entries['openclaw-wechat-access-plugin'] || {}),
    enabled: true
  }
  await fs.writeFile(OPENCLAW_CONFIG, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
}

async function generateBindLink({ env, guid, userId, loginKey, jwtToken, openId }) {
  if (!openId) {
    return null
  }
  const headers = buildAuthHeaders({ guid, userId, loginKey, jwtToken })
  const { unwrapped } = await requestApi({
    env,
    pathName: 'data/4018/forward',
    headers,
    body: {
      guid,
      user_id: Number(userId),
      open_id: openId,
      contact_type: 'open_kfid',
      web_version: WEB_VERSION,
      web_env: 'release'
    }
  })
  return unwrapped
}

async function fetchOpenId({ env, guid, userId, loginKey, jwtToken }) {
  const headers = buildAuthHeaders({ guid, userId, loginKey, jwtToken })
  const { unwrapped } = await requestApi({
    env,
    pathName: 'data/4027/forward',
    headers,
    body: {
      guid,
      web_version: WEB_VERSION,
      web_env: 'release'
    }
  })
  return unwrapped?.openid || unwrapped?.open_id || ''
}

async function generateBindLinkWithRetry(params) {
  if (!params.openId) {
    return null
  }

  for (let attempt = 1; attempt <= BIND_LINK_RETRY_COUNT; attempt += 1) {
    const payload = await generateBindLink(params)
    const normalized = normalizeBindLinkPayload(payload)
    const link = normalized?.url || normalized?.link || normalized?.resp?.url || ''
    if (link) {
      return normalized
    }
    if (attempt < BIND_LINK_RETRY_COUNT) {
      console.log(`[wechat-token] bind link not ready yet, retry ${attempt}/${BIND_LINK_RETRY_COUNT} after ${BIND_LINK_RETRY_DELAY_MS}ms...`)
      await sleep(BIND_LINK_RETRY_DELAY_MS)
    }
  }

  return null
}

async function queryBindStatus({ env, guid, userId, loginKey, jwtToken }) {
  const headers = buildAuthHeaders({ guid, userId, loginKey, jwtToken })
  const { data, unwrapped } = await requestApi({
    env,
    pathName: 'data/4019/forward',
    headers,
    body: {
      guid,
      web_version: WEB_VERSION,
      web_env: 'release'
    }
  })
  return normalizeBindStatusPayload(unwrapped ?? data)
}

function startBindPolling(params) {
  let count = 0
  console.log('\n[wechat-token] polling bind status every 2s...')
  const timer = setInterval(async () => {
    count += 1
    try {
      const status = await queryBindStatus(params)
      console.log(`[wechat-token] bind status #${count}: ${JSON.stringify(status)}`)
      if (status?.nickname || status?.external_user_id) {
        console.log('[wechat-token] bind succeeded; you can now message the bound account to test the plugin.')
        clearInterval(timer)
        return
      }
      if (count >= MAX_BIND_POLLS) {
        console.log('[wechat-token] bind polling stopped: no bound account info detected yet.')
        console.log('[wechat-token] if you already completed binding elsewhere, restart OpenClaw and test messaging manually.')
        clearInterval(timer)
      }
    } catch (error) {
      console.error('[wechat-token] bind status poll failed', error instanceof Error ? error.message : String(error))
      if (count >= MAX_BIND_POLLS) {
        clearInterval(timer)
      }
    }
  }, 2000)
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/forward') {
    try {
      const body = await readRequestBody(req)
      const payload = JSON.parse(body || '{}')
      const { upstream, renewedToken, data } = await proxyForward(payload)
      res.writeHead(upstream.status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify({ ok: upstream.ok, renewedToken, data, error: upstream.ok ? '' : upstream.statusText || `HTTP ${upstream.status}` }))
      return
    } catch (error) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify({ ok: false, renewedToken: '', data: null, error: error instanceof Error ? error.message : String(error) }))
      return
    }
  }

  if (req.method === 'POST' && req.url === '/api/result') {
    try {
      const body = await readRequestBody(req)
      const payload = JSON.parse(body || '{}')
      const token = payload?.result?.openclaw_channel_token || ''
      const guid = payload?.guid || ''
      const userId = String(payload?.result?.userInfo?.userId || '')
      const jwtToken = payload?.result?.jwt_token || ''
      const localConfig = await readLocalConfig()
      const loginKey = localConfig.loginKey || payload?.result?.userInfo?.loginKey || DEFAULT_LOGIN_KEY
      let openId = localConfig.serviceOpenId || payload?.result?.raw?.open_id || payload?.result?.raw?.openid || payload?.result?.userInfo?.open_id || DEFAULT_OPEN_ID

      console.log('\n[wechat-token] login succeeded')
      console.log(JSON.stringify(payload, null, 2))
      console.log('\n[wechat-token] Suggested openclaw.json channel block:')
      console.log(JSON.stringify({
        channels: {
          'openclaw-wechat-access-plugin': {
            enabled: true,
            name: 'OpenClaw WeChat Access Plugin',
            token,
            wsUrl: DEFAULT_WS_URL,
            guid,
            userId
          }
        }
      }, null, 2))

      if (options.applyConfig && token && guid && userId) {
        await applyWechatConfig({ token, guid, userId, wsUrl: DEFAULT_WS_URL })
        console.log(`\n[wechat-token] config applied to ${OPENCLAW_CONFIG}`)
      }

      if (options.bind) {
        try {
          if (!openId) {
            console.log('\n[wechat-token] open_id missing in login response, fetching user info...')
            openId = await fetchOpenId({ env: payload?.env, guid, userId, loginKey, jwtToken })
          }
          if (!openId) {
            console.log('[wechat-token] failed to auto-fetch usable bind open_id.')
            console.log('[wechat-token] using built-in serviceOpenId fallback from the original client is recommended for standard setup.')
          }
          console.log('\n[wechat-token] waiting for bind link readiness...')
          const bindLink = await generateBindLinkWithRetry({ env: payload?.env, guid, userId, loginKey, jwtToken, openId })
          console.log('\n[wechat-token] bind link payload:')
          console.log(JSON.stringify(bindLink, null, 2))
          const link = bindLink?.url || bindLink?.link || bindLink?.resp?.url || ''
          if (link) {
            console.log(`\n[wechat-token] open this link in the controller WeChat account:\n${link}`)
            startBindPolling({ env: payload?.env, guid, userId, loginKey, jwtToken })
          } else {
            console.log('[wechat-token] bind link unavailable; skip polling.')
            if (!openId) {
              console.log('[wechat-token] likely cause: open_id still unavailable for link generation in current environment.')
            }
          }
        } catch (error) {
          console.error('[wechat-token] bind bootstrap failed', error instanceof Error ? error.message : String(error))
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify({ ok: true }))
      return
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }))
      return
    }
  }

  const requestPath = req.url === '/' ? '/index.html' : req.url || '/index.html'
  const filePath = path.resolve(__dirname, requestPath.replace(/^\//, ''))
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Forbidden')
    return
  }
  try {
    const content = await fs.readFile(filePath)
    res.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-store' })
    res.end(content)
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Not Found')
  }
})

server.listen(port, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${port}`
  console.log(`[wechat-token] helper running at ${url}`)
  console.log(`[wechat-token] mode: applyConfig=${options.applyConfig} bind=${options.bind}`)
  console.log('[wechat-token] browser will open automatically; after scan, token will print here.')
  openBrowser(url)
})
