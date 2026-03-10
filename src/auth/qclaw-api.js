import { nested } from './utils.js'

export class TokenExpiredError extends Error {
  constructor(message = '登录已过期，请重新登录') {
    super(message)
    this.name = 'TokenExpiredError'
  }
}

export class QClawAPI {
  constructor(env, guid, jwtToken = '') {
    this.env = env
    this.guid = guid
    this.loginKey = 'm83qdao0AmE5'
    this.jwtToken = jwtToken
    this.userId = ''
  }

  _headers() {
    const h = {
      'Content-Type': 'application/json',
      'X-Version': '1',
      'X-Token': this.loginKey,
      'X-Guid': this.guid,
      'X-Account': this.userId || '1',
      'X-Session': '',
    }
    if (this.jwtToken) {
      h['X-OpenClaw-Token'] = this.jwtToken
    }
    return h
  }

  async _post(path, body = {}) {
    const url = `${this.env.jprxGateway}${path}`
    const payload = { ...body, web_version: '1.4.0', web_env: 'release' }

    const res = await fetch(url, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    })

    // Token renewal
    const newToken = res.headers.get('X-New-Token')
    if (newToken) this.jwtToken = newToken

    const data = await res.json()

    const ret = data.ret
    const commonCode =
      nested(data, 'data', 'resp', 'common', 'code') ??
      nested(data, 'data', 'common', 'code') ??
      nested(data, 'resp', 'common', 'code') ??
      nested(data, 'common', 'code')

    // Token expired
    if (commonCode === 21004) {
      throw new TokenExpiredError()
    }

    if (ret === 0 || commonCode === 0) {
      const nonEmpty = (v) =>
        v != null && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0
          ? undefined
          : v
      const respData =
        nonEmpty(nested(data, 'data', 'resp', 'data')) ??
        nonEmpty(nested(data, 'data', 'data')) ??
        data.data ??
        data
      return { success: true, data: respData }
    }

    const message =
      nested(data, 'data', 'common', 'message') ??
      nested(data, 'resp', 'common', 'message') ??
      nested(data, 'common', 'message') ??
      '请求失败'
    return { success: false, message, data }
  }

  async getWxLoginState() {
    return this._post('data/4050/forward', { guid: this.guid })
  }

  async wxLogin(code, state) {
    return this._post('data/4026/forward', { guid: this.guid, code, state })
  }

  async createApiKey() {
    return this._post('data/4055/forward', {})
  }

  async getUserInfo() {
    return this._post('data/4027/forward', {})
  }

  async checkInviteCode(userId) {
    return this._post('data/4056/forward', { user_id: userId })
  }

  async submitInviteCode(userId, code) {
    return this._post('data/4057/forward', { user_id: userId, code })
  }

  async refreshChannelToken() {
    const result = await this._post('data/4058/forward', {})
    if (result.success) {
      const d = result.data
      return nested(d, 'openclaw_channel_token')
        || nested(d, 'data', 'openclaw_channel_token')
        || null
    }
    return null
  }

  async generateContactLink(openKfId) {
    return this._post('data/4018/forward', {
      guid: this.guid,
      user_id: Number(this.userId),
      open_id: openKfId,
      contact_type: 'open_kfid',
    })
  }

  async queryDeviceByGuid() {
    return this._post('data/4019/forward', { guid: this.guid })
  }

  async disconnectDevice() {
    return this._post('data/4020/forward', { guid: this.guid })
  }
}
