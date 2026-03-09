const PING_INTERVAL_MS = 20000
const RETRY_DELAY_MS = 5000

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
  url.searchParams.set('token', account.token)
  url.searchParams.set('guid', String(account.guid))
  url.searchParams.set('user_id', String(account.userId))
  return url
}

export async function runWechatWsClient({ account, abortSignal, log, onPrompt }) {
  while (!abortSignal.aborted) {
    let ws = null
    let heartbeat = null
    try {
      ws = new WebSocket(buildUrl(account))
      await new Promise((resolve, reject) => {
        const onOpen = () => {
          cleanup()
          resolve()
        }
        const onError = (event) => {
          cleanup()
          reject(event.error || new Error('WebSocket connection failed'))
        }
        const onAbort = () => {
          cleanup()
          try {
            ws.close(1000, 'aborted')
          } catch {}
          resolve()
        }
        const cleanup = () => {
          ws.removeEventListener('open', onOpen)
          ws.removeEventListener('error', onError)
          abortSignal.removeEventListener('abort', onAbort)
        }
        ws.addEventListener('open', onOpen, { once: true })
        ws.addEventListener('error', onError, { once: true })
        abortSignal.addEventListener('abort', onAbort, { once: true })
      })

      if (abortSignal.aborted) {
        break
      }

      log?.info?.('openclaw-wechat-access-plugin connected')
      heartbeat = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping', ts: Date.now() }))
        }
      }, PING_INTERVAL_MS)

      await new Promise((resolve) => {
        const onMessage = async (event) => {
          const raw = String(event.data || '')
          log?.info?.(`openclaw-wechat-access-plugin inbound ${raw}`)
          let message = null
          try {
            message = JSON.parse(raw)
          } catch {
            return
          }
          if (message?.method === 'session.prompt') {
            await onPrompt({ ws, message })
          }
        }
        const onClose = (event) => {
          cleanup()
          log?.warn?.(`openclaw-wechat-access-plugin closed code=${event.code} reason=${event.reason || ''}`)
          resolve()
        }
        const onError = (event) => {
          log?.error?.(`openclaw-wechat-access-plugin error ${event.message || event.error || 'unknown error'}`)
        }
        const onAbort = () => {
          cleanup()
          try {
            ws.close(1000, 'aborted')
          } catch {}
          resolve()
        }
        const cleanup = () => {
          ws.removeEventListener('message', onMessage)
          ws.removeEventListener('close', onClose)
          ws.removeEventListener('error', onError)
          abortSignal.removeEventListener('abort', onAbort)
        }
        ws.addEventListener('message', onMessage)
        ws.addEventListener('close', onClose, { once: true })
        ws.addEventListener('error', onError)
        abortSignal.addEventListener('abort', onAbort, { once: true })
      })
    } catch (error) {
      log?.error?.(`openclaw-wechat-access-plugin connect failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      if (heartbeat) {
        clearInterval(heartbeat)
      }
      try {
        ws?.close()
      } catch {}
    }

    if (!abortSignal.aborted) {
      await sleep(RETRY_DELAY_MS, abortSignal)
    }
  }
}
