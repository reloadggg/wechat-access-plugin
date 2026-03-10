import WebSocket from 'ws'

const RETRY_BASE_DELAY_MS = 3000
const RETRY_MAX_DELAY_MS = 25000
const HEARTBEAT_INTERVAL_MS = 20000
const WAKEUP_CHECK_INTERVAL_MS = 5000
const WAKEUP_THRESHOLD_MS = 15000

function sleep(ms, signal) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      resolve()
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function buildUrl(account) {
  const url = new URL(account.wsUrl)
  if (account.token) {
    url.searchParams.set('token', String(account.token))
  }
  if (account.guid) {
    url.searchParams.set('guid', String(account.guid))
  }
  if (account.userId) {
    url.searchParams.set('user_id', String(account.userId))
  }
  return url.toString()
}

function mask(value) {
  if (!value) return '(empty)'
  return `${String(value).slice(0, 6)}...`
}

export async function runWechatWsClient({ account, abortSignal, log, onPrompt, onCancel }) {
  let reconnectAttempts = 0

  while (!abortSignal.aborted) {
    let ws = null
    let heartbeatTimer = null
    let wakeupTimer = null
    let lastPongAt = Date.now()
    let lastTickAt = Date.now()

    try {
      const url = buildUrl(account)
      log?.info?.(`openclaw-wechat-access-plugin connecting url=${account.wsUrl} token=${mask(account.token)} guid=${account.guid || '(empty)'} userId=${account.userId || '(empty)'} queryIdentityMode=${account.queryIdentityMode || 'token-only'}`)
      ws = new WebSocket(url)

      await new Promise((resolve, reject) => {
        const onOpen = () => {
          cleanup()
          resolve()
        }
        const onError = (error) => {
          cleanup()
          reject(error instanceof Error ? error : new Error('WebSocket connection failed'))
        }
        const onAbort = () => {
          cleanup()
          try { ws.close() } catch {}
          resolve()
        }
        const cleanup = () => {
          ws.off('open', onOpen)
          ws.off('error', onError)
          abortSignal.removeEventListener('abort', onAbort)
        }
        ws.once('open', onOpen)
        ws.once('error', onError)
        abortSignal.addEventListener('abort', onAbort, { once: true })
      })

      if (abortSignal.aborted) {
        break
      }

      reconnectAttempts = 0
      log?.info?.('openclaw-wechat-access-plugin WebSocket 连接成功')

      ws.on('pong', () => {
        lastPongAt = Date.now()
      })

      heartbeatTimer = setInterval(() => {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          return
        }
        const pongTimeout = HEARTBEAT_INTERVAL_MS * 2
        if (Date.now() - lastPongAt > pongTimeout) {
          log?.warn?.(`openclaw-wechat-access-plugin pong 超时 ${pongTimeout}ms，主动断开重连`)
          ws.terminate()
          return
        }
        try {
          ws.ping()
        } catch {
          log?.warn?.('openclaw-wechat-access-plugin 心跳发送失败，主动断开重连')
          ws.terminate()
        }
      }, HEARTBEAT_INTERVAL_MS)

      wakeupTimer = setInterval(() => {
        const now = Date.now()
        const elapsed = now - lastTickAt
        lastTickAt = now
        if (elapsed > WAKEUP_THRESHOLD_MS && ws && ws.readyState === WebSocket.OPEN) {
          log?.warn?.(`openclaw-wechat-access-plugin 检测到系统唤醒，tick 间隔 ${elapsed}ms，主动断开重连`)
          reconnectAttempts = 0
          ws.terminate()
        }
      }, WAKEUP_CHECK_INTERVAL_MS)

      await new Promise((resolve) => {
        const onMessageInternal = async (rawData) => {
          try {
            const raw = typeof rawData === 'string' ? rawData : rawData.toString()
            log?.info?.(`openclaw-wechat-access-plugin inbound ${raw}`)
            const message = JSON.parse(raw)
            if (message?.method === 'session.prompt') {
              await onPrompt?.({ ws, message })
            } else if (message?.method === 'session.cancel') {
              await onCancel?.({ ws, message })
            }
          } catch (error) {
            log?.error?.(`openclaw-wechat-access-plugin 消息处理失败: ${error instanceof Error ? error.message : String(error)}`)
          }
        }
        const onClose = (code, reason) => {
          cleanup()
          log?.warn?.(`openclaw-wechat-access-plugin 连接关闭 code=${code} reason=${reason?.toString?.() || ''}`)
          resolve()
        }
        const onError = (error) => {
          log?.error?.(`openclaw-wechat-access-plugin 连接错误: ${error instanceof Error ? error.message : String(error)}`)
        }
        const onAbort = () => {
          cleanup()
          try { ws.close() } catch {}
          resolve()
        }
        const cleanup = () => {
          ws.off('message', onMessageInternal)
          ws.off('close', onClose)
          ws.off('error', onError)
          abortSignal.removeEventListener('abort', onAbort)
        }
        ws.on('message', onMessageInternal)
        ws.once('close', onClose)
        ws.on('error', onError)
        abortSignal.addEventListener('abort', onAbort, { once: true })
      })
    } catch (error) {
      log?.error?.(`openclaw-wechat-access-plugin 连接失败: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      if (heartbeatTimer) clearInterval(heartbeatTimer)
      if (wakeupTimer) clearInterval(wakeupTimer)
      try { ws?.close() } catch {}
    }

    if (!abortSignal.aborted) {
      reconnectAttempts += 1
      const delay = Math.min(RETRY_BASE_DELAY_MS * Math.pow(1.5, Math.max(0, reconnectAttempts - 1)), RETRY_MAX_DELAY_MS)
      log?.warn?.(`openclaw-wechat-access-plugin ${delay}ms 后进行第 ${reconnectAttempts} 次重连`)
      await sleep(delay, abortSignal)
    }
  }
}
