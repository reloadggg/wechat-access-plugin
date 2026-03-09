const ENV_CONFIG = {
  production: {
    appId: 'wx9d11056dd75b7240'
  },
  test: {
    appId: 'wx3dd49afb7e2cf957'
  }
}

const DEFAULT_LOGIN_KEY = ''
const WEB_VERSION = '1.4.0'

const state = {
  env: 'production',
  guid: '',
  loginState: '',
  loginKey: DEFAULT_LOGIN_KEY,
  jwtToken: '',
  userInfo: null
}

const elements = {
  envSelect: document.querySelector('#env-select'),
  guidInput: document.querySelector('#guid-input'),
  statusBadge: document.querySelector('#status-badge'),
  qrcodeTip: document.querySelector('#qrcode-tip'),
  startLogin: document.querySelector('#start-login'),
  refreshState: document.querySelector('#refresh-state'),
  clearLog: document.querySelector('#clear-log'),
  logOutput: document.querySelector('#log-output'),
  qrContainer: document.querySelector('#wx_login')
}

function log(message, detail) {
  const prefix = `[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${message}`
  const extra = detail === undefined ? '' : `\n${typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2)}`
  elements.logOutput.textContent = `${prefix}${extra}\n\n${elements.logOutput.textContent}`.trim()
}

function setStatus(kind, text) {
  elements.statusBadge.className = `badge ${kind}`
  elements.statusBadge.textContent = text
}

function randomGuid() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID().replace(/-/g, '')
  }
  return `${Date.now()}${Math.random().toString(16).slice(2, 12)}`
}

function ensureGuid() {
  state.guid = elements.guidInput.value.trim() || state.guid || randomGuid()
  elements.guidInput.value = state.guid
}

function buildHeaders() {
  const headers = {
    'Content-Type': 'application/json',
    'X-Version': '1',
    'X-Token': state.userInfo?.loginKey || state.loginKey || DEFAULT_LOGIN_KEY,
    'X-Guid': state.userInfo?.guid || state.guid || '1',
    'X-Account': state.userInfo?.userId || '1',
    'X-Session': ''
  }
  if (state.jwtToken) {
    headers['X-OpenClaw-Token'] = state.jwtToken
  }
  return headers
}

async function request(path, body = {}) {
  const payload = { ...body, web_version: WEB_VERSION, web_env: 'release' }
  log(`请求 ${path}`, { env: state.env, payload })

  const response = await fetch('/api/forward', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ env: state.env, path, body: payload, headers: buildHeaders() })
  })
  const result = await response.json()
  if (!response.ok) {
    throw new Error(result.error || `HTTP ${response.status}`)
  }
  if (result.renewedToken) {
    state.jwtToken = result.renewedToken
  }
  const data = result.data
  log(`响应 ${path}`, { status: response.status, data })
  const topCode = data?.ret
  const nestedRespCode = data?.data?.resp?.common?.code
  const commonCode = data?.data?.common?.code ?? data?.resp?.common?.code ?? data?.common?.code
  if (nestedRespCode !== undefined && nestedRespCode !== null && nestedRespCode !== 0 && topCode === 0) {
    throw new Error(data?.data?.resp?.common?.message || '业务请求失败')
  }
  if (topCode === 0 || commonCode === 0) {
    return { data: data?.data ?? data?.resp ?? data, raw: data }
  }
  throw new Error(data?.data?.common?.message || data?.resp?.common?.message || data?.common?.message || '业务请求失败')
}

async function getWxLoginState(guid) {
  return request('data/4050/forward', { guid })
}

async function wxLogin({ guid, code, stateValue }) {
  return request('data/4026/forward', { guid, code, state: stateValue })
}

function normalizeWxLoginPayload(result) {
  const payload = result?.data?.resp?.data || result?.data?.data || result?.data || result?.raw?.data?.resp?.data || result?.raw?.data || result?.raw || {}
  const userInfo = payload.user_info
    ? {
        ...payload.user_info,
        avatar: payload.user_info.avatar_url || payload.user_info.avatar || '',
        userId: payload.user_info.user_id,
        guid: state.guid,
        loginKey: payload.user_info.login_key || payload.user_info.loginKey || payload.login_key || payload.loginKey || DEFAULT_LOGIN_KEY
      }
    : null

  return {
    jwt_token: payload.token || '',
    openclaw_channel_token: payload.openclaw_channel_token || '',
    userInfo,
    raw: payload
  }
}

async function refreshLoginState() {
  ensureGuid()
  setStatus('pending', '获取 state')
  const result = await getWxLoginState(state.guid)
  const stateValue = result?.data?.state || result?.raw?.data?.resp?.data?.state || result?.raw?.data?.state
  if (!stateValue) {
    throw new Error('未拿到微信登录 state')
  }
  state.loginState = stateValue
  setStatus('success', '等待扫码')
  elements.qrcodeTip.textContent = `已拿到 state，等待扫码。state=${stateValue}`
  log('微信登录 state 已刷新', { guid: state.guid, state: stateValue })
  return stateValue
}

function mountQrcode(stateValue) {
  elements.qrContainer.innerHTML = ''
  elements.qrcodeTip.textContent = '二维码生成中...'
  new window.WxLogin({
    self_redirect: true,
    id: 'wx_login',
    appid: ENV_CONFIG[state.env].appId,
    scope: 'snsapi_login',
    redirect_uri: encodeURIComponent('https://security.guanjia.qq.com/login'),
    state: stateValue,
    style: 'black',
    onReady() {
      log('二维码已生成')
      elements.qrcodeTip.textContent = '扫码成功后，结果会直接打印到启动命令的终端。'
    }
  })
}

async function handleCode(code) {
  setStatus('pending', '换取 token')
  log('收到微信回传 code', { code })
  const result = await wxLogin({ guid: state.guid, code, stateValue: state.loginState })
  const normalized = normalizeWxLoginPayload(result)
  state.jwtToken = normalized.jwt_token || ''
  state.userInfo = normalized.userInfo
  state.loginKey = normalized.userInfo?.loginKey || DEFAULT_LOGIN_KEY

  await fetch('/api/result', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      env: state.env,
      guid: state.guid,
      result: normalized
    })
  })

  setStatus('success', '成功')
  elements.qrcodeTip.textContent = '成功，终端已打印 token。你可以关闭这个页面。'
  log('token 已回传到终端')
}

async function startLoginFlow() {
  try {
    const stateValue = await refreshLoginState()
    mountQrcode(stateValue)
  } catch (error) {
    setStatus('error', '启动失败')
    log('启动登录失败', String(error))
  }
}

function bindEvents() {
  elements.envSelect.addEventListener('change', () => {
    state.env = elements.envSelect.value
    log('已切换环境', { env: state.env })
  })
  elements.startLogin.addEventListener('click', startLoginFlow)
  elements.refreshState.addEventListener('click', startLoginFlow)
  elements.clearLog.addEventListener('click', () => {
    elements.logOutput.textContent = ''
  })
  window.addEventListener('message', (event) => {
    const payload = event.data
    if (!payload || payload.type !== 'sendCode') {
      return
    }
    handleCode(payload.data).catch((error) => {
      setStatus('error', '提取失败')
      log('处理扫码回调失败', String(error))
    })
  })
}

state.env = elements.envSelect.value
ensureGuid()
bindEvents()
log('控制台取 token 工具已就绪', { env: state.env, guid: state.guid })
