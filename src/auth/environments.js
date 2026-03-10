const ENVIRONMENTS = {
  production: {
    jprxGateway: 'https://jprx.m.qq.com/',
    qclawBaseUrl: 'https://mmgrcalltoken.3g.qq.com/aizone/v1',
    wxLoginRedirectUri: 'https://security.guanjia.qq.com/login',
    wechatWsUrl: 'wss://mmgrcalltoken.3g.qq.com/agentwss',
    wxAppId: 'wx9d11056dd75b7240',
  },
  test: {
    jprxGateway: 'https://jprx.sparta.html5.qq.com/',
    qclawBaseUrl: 'https://jprx.sparta.html5.qq.com/aizone/v1',
    wxLoginRedirectUri: 'https://security-test.guanjia.qq.com/login',
    wechatWsUrl: 'wss://jprx.sparta.html5.qq.com/agentwss',
    wxAppId: 'wx3dd49afb7e2cf957',
  },
}

export function getEnvironment(name) {
  const env = ENVIRONMENTS[name]
  if (!env) throw new Error(`Unknown environment: ${name}, available: ${Object.keys(ENVIRONMENTS).join(', ')}`)
  return env
}
