import process from 'node:process'
import fs from 'node:fs/promises'
import path from 'node:path'

const BASE_URL = 'https://jprx.m.qq.com/'
const WEB_VERSION = '1.4.0'
const DEFAULT_LOGIN_KEY = process.env.WECHAT_LOGIN_KEY || 'm83qdao0AmE5'
const DEFAULT_OPEN_ID = process.env.WECHAT_DEFAULT_OPEN_ID || 'wkzLlJLAAAfbxEV3ZcS-lHZxkaKmpejQ'
const PROJECT_ROOT = process.cwd()

function parseArgs(argv) {
  const args = {
    guid: '',
    userId: '',
    jwt: '',
    loginKey: DEFAULT_LOGIN_KEY,
    openId: DEFAULT_OPEN_ID,
    poll: true,
    help: false
  }

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') args.help = true
    else if (arg === '--guid') args.guid = argv[++i]
    else if (arg === '--user-id') args.userId = argv[++i]
    else if (arg === '--jwt') args.jwt = argv[++i]
    else if (arg === '--login-key') args.loginKey = argv[++i]
    else if (arg === '--open-id') args.openId = argv[++i]
    else if (arg === '--no-poll') args.poll = false
    else throw new Error(`Unknown argument: ${arg}`)
  }

  return args
}

function printHelp() {
  console.log(`Usage:
  npm run bind-link -- --guid YOUR_GUID --user-id YOUR_USER_ID --jwt YOUR_JWT [--open-id YOUR_OPEN_ID]

Required:
  --guid       guid returned by token tool
  --user-id    userInfo.userId returned by token tool
  --jwt        jwt_token returned by token tool
  --open-id    optional; if omitted the script will try data/4027/forward first

Optional:
  --login-key  defaults to WECHAT_LOGIN_KEY or m83qdao0AmE5
  --no-poll    do not poll bind status after generating link
`)
}

function buildHeaders({ guid, userId, jwt, loginKey }) {
  return {
    'Content-Type': 'application/json',
    'X-Version': '1',
    'X-Token': loginKey,
    'X-Guid': guid,
    'X-Account': String(userId),
    'X-Session': '',
    'X-OpenClaw-Token': jwt
  }
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

function unwrapData(data) {
  return data?.data?.resp?.data ?? data?.data?.data ?? data?.resp?.data ?? data?.data ?? data
}

async function callApi({ pathName, headers, body }) {
  const response = await fetch(new URL(pathName, BASE_URL), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ...body,
      web_version: WEB_VERSION,
      web_env: 'release'
    })
  })
  const data = await response.json()
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  return unwrapData(data)
}

async function fetchOpenId(args, headers) {
  const payload = await callApi({
    pathName: 'data/4027/forward',
    headers,
    body: { guid: args.guid }
  })
  return payload?.openid || payload?.open_id || ''
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function pollStatus(args, headers) {
  for (let i = 1; i <= 20; i += 1) {
    const status = await callApi({
      pathName: 'data/4019/forward',
      headers,
      body: { guid: args.guid }
    })
    console.log(`[bind-link] status #${i}: ${JSON.stringify(status)}`)
    if (status?.nickname || status?.external_user_id) {
      console.log('[bind-link] bind succeeded')
      return
    }
    await sleep(2000)
  }
  console.log('[bind-link] polling finished without confirmed bind success')
}

async function main() {
  const args = parseArgs(process.argv)
  if (args.help) {
    printHelp()
    return
  }
  if (!(args.guid && args.userId && args.jwt)) {
    throw new Error('Missing required arguments: --guid --user-id --jwt')
  }

  const localConfig = await readLocalConfig()
  args.loginKey = args.loginKey || localConfig.loginKey || DEFAULT_LOGIN_KEY
  args.openId = args.openId || localConfig.serviceOpenId || DEFAULT_OPEN_ID
  const headers = buildHeaders(args)
  if (!args.openId) {
    args.openId = await fetchOpenId(args, headers)
  }
  if (!args.openId) {
    throw new Error('open_id unavailable; pass --open-id or set WECHAT_DEFAULT_OPEN_ID')
  }
  const linkPayload = await callApi({
    pathName: 'data/4018/forward',
    headers,
    body: {
      guid: args.guid,
      user_id: Number(args.userId),
      open_id: args.openId,
      contact_type: 'open_kfid'
    }
  })

  console.log('[bind-link] payload:')
  console.log(JSON.stringify(linkPayload, null, 2))

  const link = linkPayload?.resp?.url || linkPayload?.url || linkPayload?.link || ''
  if (!link) {
    console.log('[bind-link] no bind link returned')
    return
  }

  console.log(`\n[bind-link] open this link in the controller WeChat account:\n${link}`)
  if (args.poll) {
    await pollStatus(args, headers)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
