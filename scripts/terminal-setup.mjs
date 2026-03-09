import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { spawn } from 'node:child_process'

const DEFAULT_WS_URL = 'wss://mmgrcalltoken.3g.qq.com/agentwss'
const WEB_VERSION = '1.4.0'
const MAX_BIND_POLLS = 20
const DEFAULT_LOGIN_KEY = process.env.WECHAT_LOGIN_KEY || 'm83qdao0AmE5'
const DEFAULT_OPEN_ID = process.env.WECHAT_DEFAULT_OPEN_ID || 'wkzLlJLAAAfbxEV3ZcS-lHZxkaKmpejQ'
const PROJECT_ROOT = process.cwd()

function parseArgs(argv) {
  return {
    skipInstall: argv.includes('--skip-install')
  }
}

function resolveOpenClawConfigPath() {
  if (process.env.OPENCLAW_CONFIG) return path.resolve(process.env.OPENCLAW_CONFIG)
  if (process.env.OPENCLAW_HOME) return path.join(path.resolve(process.env.OPENCLAW_HOME), 'openclaw.json')
  return path.join(process.env.USERPROFILE || process.env.HOME || '.', '.openclaw', 'openclaw.json')
}

const OPENCLAW_CONFIG = resolveOpenClawConfigPath()

function readLocalConfig() {
  return fs.readFile(path.join(PROJECT_ROOT, 'wechat-access.local.json'), 'utf8')
    .then((raw) => JSON.parse(raw))
    .catch(() => ({}))
}

function spawnChecked(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: PROJECT_ROOT, stdio: 'inherit', shell: false })
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} exited with code ${code}`))
    })
    child.on('error', reject)
  })
}

async function installLocal() {
  await spawnChecked(process.execPath, ['scripts/install-local.mjs'])
}

async function runTerminalLogin() {
  const resultFile = path.join(os.tmpdir(), `wechat-terminal-login-${Date.now()}.json`)
  await spawnChecked(process.execPath, ['scripts/terminal-login.mjs', '--result-file', resultFile])
  const raw = await fs.readFile(resultFile, 'utf8')
  await fs.rm(resultFile, { force: true })
  return JSON.parse(raw)
}

async function applyWechatConfig({ token, guid, userId }) {
  const config = JSON.parse(await fs.readFile(OPENCLAW_CONFIG, 'utf8'))
  config.channels ||= {}
  config.channels['openclaw-wechat-access-plugin'] = {
    enabled: true,
    name: 'OpenClaw WeChat Access Plugin',
    token,
    wsUrl: DEFAULT_WS_URL,
    guid,
    userId: String(userId)
  }
  config.plugins ||= {}
  config.plugins.allow = Array.isArray(config.plugins.allow) ? config.plugins.allow : []
  if (!config.plugins.allow.includes('openclaw-wechat-access-plugin')) config.plugins.allow.push('openclaw-wechat-access-plugin')
  config.plugins.entries ||= {}
  config.plugins.entries['openclaw-wechat-access-plugin'] = {
    ...(config.plugins.entries['openclaw-wechat-access-plugin'] || {}),
    enabled: true
  }
  await fs.writeFile(OPENCLAW_CONFIG, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  console.log(`\n[微信安装] 配置已写入 ${OPENCLAW_CONFIG}`)
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

function unwrapData(data) {
  return data?.data?.resp?.data ?? data?.data?.data ?? data?.resp?.data ?? data?.data ?? data
}

function normalizeBindLinkPayload(payload) {
  return payload?.resp ?? payload?.data?.resp ?? payload ?? null
}

function normalizeBindStatusPayload(payload) {
  return payload?.resp?.data ?? payload?.data?.resp?.data ?? payload?.data ?? payload?.resp ?? payload ?? null
}

async function requestApi({ pathName, headers, body }) {
  const response = await fetch(new URL(pathName, 'https://jprx.m.qq.com/'), {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...body, web_version: WEB_VERSION, web_env: 'release' })
  })
  const data = await response.json()
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return { data, unwrapped: unwrapData(data) }
}

async function generateBindLink(params) {
  if (!params.openId) return null
  const headers = buildAuthHeaders(params)
  const { unwrapped } = await requestApi({
    pathName: 'data/4018/forward',
    headers,
    body: {
      guid: params.guid,
      user_id: Number(params.userId),
      open_id: params.openId,
      contact_type: 'open_kfid'
    }
  })
  return normalizeBindLinkPayload(unwrapped)
}

async function queryBindStatus(params) {
  const headers = buildAuthHeaders(params)
  const { data, unwrapped } = await requestApi({
    pathName: 'data/4019/forward',
    headers,
    body: { guid: params.guid }
  })
  return normalizeBindStatusPayload(unwrapped ?? data)
}

async function main() {
  const args = parseArgs(process.argv)

  if (!args.skipInstall) {
    console.log('[微信安装] 正在安装插件...')
    await installLocal()
  }

  console.log('\n[微信安装] 正在启动终端二维码登录...')
  const payload = await runTerminalLogin()
  const token = payload?.result?.openclaw_channel_token || ''
  const guid = payload?.guid || ''
  const userId = payload?.result?.user_info?.user_id || payload?.result?.userId || payload?.result?.userInfo?.userId || ''
  const jwtToken = payload?.result?.token || payload?.result?.jwt_token || ''

  if (!(token && guid && userId)) {
    throw new Error('终端登录没有返回 token/guid/userId')
  }

  await applyWechatConfig({ token, guid, userId })

  const localConfig = await readLocalConfig()
  const bindParams = {
    guid,
    userId,
    jwtToken,
    loginKey: localConfig.loginKey || DEFAULT_LOGIN_KEY,
    openId: localConfig.serviceOpenId || DEFAULT_OPEN_ID
  }

  console.log('\n[微信安装] 正在生成绑定设备链接...')
  const bindLink = await generateBindLink(bindParams)
  console.log('[微信安装] 绑定链接返回：')
  console.log(JSON.stringify(bindLink, null, 2))
  const link = bindLink?.url || bindLink?.link || bindLink?.resp?.url || ''
  if (!link) {
    console.log('[微信安装] 没有生成绑定链接，流程先停在这里。')
    return
  }

  console.log(`\n[微信安装] 请把下面这个链接复制到“控制端微信”里打开：\n${link}`)
  console.log('\n[微信安装] 每 2 秒检查一次绑定状态...')
  for (let i = 1; i <= MAX_BIND_POLLS; i += 1) {
    const status = await queryBindStatus(bindParams)
    console.log(`[微信安装] 绑定状态 #${i}: ${JSON.stringify(status)}`)
    if (status?.nickname || status?.external_user_id) {
      console.log('\n[微信安装] 绑定成功，请现在重启 OpenClaw。')
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }

  console.log('\n[微信安装] 绑定轮询结束。如果你已经在微信里打开过链接，请重启 OpenClaw 后手动发消息测试。')
}

main().catch((error) => {
  console.error(`\n[微信安装] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
