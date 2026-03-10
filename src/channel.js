import crypto from 'node:crypto'
import process from 'node:process'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import { runWechatWsClient } from './ws-client.js'
import { getDeviceGuid, getEnvironment, QClawAPI, TokenExpiredError, loadState, saveState, clearState } from './auth/index.js'

const CHANNEL_ID = 'openclaw-wechat-access-plugin'
const DEFAULT_ACCOUNT_ID = 'main'
const bootstrappingAccounts = new Set()

// ============================================
// Runtime storage (mirrors official setWecomRuntime/getWecomRuntime)
// ============================================
let _runtime = null
export function setPluginRuntime(rt) { _runtime = rt }
function getRuntime() { return _runtime }

// ============================================
// Active turn tracking (mirrors official activeTurns Map)
// ============================================
const activeTurns = new Map()

// ============================================
// Account running state (for status adapter)
// ============================================
const accountRunning = new Map()

// ============================================
// Agent event subscription (JS port of official agent-events.ts)
// Dynamic import of openclaw/plugin-sdk, graceful fallback if unavailable
// ============================================
let _onAgentEvent = null
const sdkReady = (async () => {
  try {
    const sdk = await import('openclaw/plugin-sdk')
    if (typeof sdk.onAgentEvent === 'function') {
      _onAgentEvent = sdk.onAgentEvent
    }
  } catch {
    // openclaw/plugin-sdk not available in this environment
  }
  return _onAgentEvent
})()

async function subscribeAgentEvent(listener) {
  const fn = await sdkReady
  if (fn) return fn(listener)
  return () => false
}

// ============================================
// Preserved helpers
// ============================================

function launchTerminalBootstrap(ctx) {
  if (bootstrappingAccounts.has(ctx.accountId)) {
    return
  }

  bootstrappingAccounts.add(ctx.accountId)
  const scriptPath = fileURLToPath(new URL('../scripts/terminal-setup.mjs', import.meta.url))
  const child = spawn(process.execPath, [scriptPath, '--skip-install'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    stdio: 'inherit',
    env: process.env,
    detached: false
  })

  child.on('exit', () => {
    bootstrappingAccounts.delete(ctx.accountId)
  })

  child.on('error', (error) => {
    bootstrappingAccounts.delete(ctx.accountId)
    ctx.log?.error?.(`[${CHANNEL_ID}] bootstrap failed: ${error instanceof Error ? error.message : String(error)}`)
  })
}

function getChannelConfig(cfg) {
  return cfg?.channels?.[CHANNEL_ID] || {}
}

function resolveAccount(cfg, accountId = DEFAULT_ACCOUNT_ID) {
  const channelCfg = getChannelConfig(cfg)
  return {
    accountId,
    enabled: channelCfg.enabled !== false,
    token: channelCfg.token || '',
    wsUrl: channelCfg.wsUrl || '',
    guid: channelCfg.guid || '',
    userId: channelCfg.userId || '',
    name: channelCfg.name || 'WeChat Access'
  }
}

function extractPromptText(message) {
  const content = Array.isArray(message?.payload?.content) ? message.payload.content : []
  return content
    .filter((item) => item && item.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text)
    .join('\n')
    .trim()
}

function summarizePromptContent(message) {
  const content = Array.isArray(message?.payload?.content) ? message.payload.content : []
  return content.map((item, index) => {
    if (!item || typeof item !== 'object') {
      return { index, type: typeof item, value: item }
    }
    const summary = { index, type: item.type || 'unknown' }
    for (const key of ['text', 'image_url', 'imageUrl', 'file_url', 'fileUrl', 'mime_type', 'mimeType', 'name']) {
      if (key in item) {
        summary[key] = item[key]
      }
    }
    return summary
  })
}

// ============================================
// sendEnvelope — standalone helper for sending AGP messages
// ============================================
function sendEnvelope(ws, method, payload, guid, userId) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return false
  }
  try {
    ws.send(JSON.stringify({
      msg_id: crypto.randomUUID(),
      guid: String(guid || ''),
      user_id: String(userId || ''),
      method,
      payload
    }))
    return true
  } catch (err) {
    console.error(`[${CHANNEL_ID}] sendEnvelope failed: ${err instanceof Error ? err.message : String(err)}`)
    return false
  }
}

// ============================================
// mapToolKind — copied from official version
// ============================================
function mapToolKind(toolName) {
  if (!toolName) return 'other'
  const name = toolName.toLowerCase()
  if (name.includes('read') || name.includes('get') || name.includes('view')) return 'read'
  if (name.includes('write') || name.includes('edit') || name.includes('replace')) return 'edit'
  if (name.includes('delete') || name.includes('remove')) return 'delete'
  if (name.includes('search') || name.includes('find') || name.includes('grep')) return 'search'
  if (name.includes('fetch') || name.includes('request') || name.includes('http')) return 'fetch'
  if (name.includes('think') || name.includes('reason')) return 'think'
  if (name.includes('exec') || name.includes('run') || name.includes('terminal')) return 'execute'
  return 'other'
}

// ============================================
// handlePrompt — aligned with official message-handler.ts
// ============================================
async function handlePrompt({ ctx, ws, message }) {
  const userId = String(message?.user_id ?? '')
  const guid = String(message?.guid ?? '')
  const { payload } = message || {}
  const sessionId = payload?.session_id || crypto.randomUUID()
  const promptId = payload?.prompt_id || crypto.randomUUID()

  const promptText = extractPromptText(message)
  const contentSummary = summarizePromptContent(message)
  ctx.log?.info?.(`[${CHANNEL_ID}] inbound content=${JSON.stringify(contentSummary)}`)

  if (!promptText) {
    ctx.log?.warn?.(`[${CHANNEL_ID}] prompt contained no text blocks; check content summary for possible media payloads`)
    return
  }

  // 1. Register active turn (for cancel support)
  const turn = { sessionId, promptId, cancelled: false, unsubscribe: null }
  activeTurns.set(promptId, turn)

  try {
    const runtime = getRuntime()

    // Load config — prefer runtime.config.loadConfig(), fallback to ctx snapshot
    const cfg = runtime?.config?.loadConfig?.()
      ?? (ctx.runtime?.config?.getSnapshot ? ctx.runtime.config.getSnapshot() : ctx.cfg)

    // 2. Resolve agent route — try new API, fallback to defaults
    let route
    try {
      if (runtime?.channel?.routing?.resolveAgentRoute) {
        const frameworkRoute = runtime.channel.routing.resolveAgentRoute({
          cfg,
          channel: CHANNEL_ID,
          accountId: ctx.accountId || DEFAULT_ACCOUNT_ID,
          peer: { kind: 'dm', id: userId || sessionId }
        })
        const channelSessionKey = `agent:${frameworkRoute.agentId}:${CHANNEL_ID}:direct:${userId || sessionId}`
        route = { ...frameworkRoute, sessionKey: channelSessionKey }
        ctx.log?.info?.(`[${CHANNEL_ID}] resolveAgentRoute OK agentId=${route.agentId} sessionKey=${route.sessionKey}`)
      }
    } catch (err) {
      ctx.log?.warn?.(`[${CHANNEL_ID}] resolveAgentRoute failed: ${err instanceof Error ? err.message : String(err)}; using fallback`)
    }

    if (!route) {
      route = {
        agentId: 'main',
        accountId: ctx.accountId || DEFAULT_ACCOUNT_ID,
        sessionKey: `agent:main:${CHANNEL_ID}:direct:${userId || sessionId}`
      }
      ctx.log?.info?.(`[${CHANNEL_ID}] using fallback route sessionKey=${route.sessionKey}`)
    }

    // 3. Resolve store path
    let storePath
    try {
      if (runtime?.channel?.session?.resolveStorePath) {
        storePath = runtime.channel.session.resolveStorePath(cfg?.session?.store, {
          agentId: route.agentId
        })
      }
    } catch (err) {
      ctx.log?.warn?.(`[${CHANNEL_ID}] resolveStorePath failed: ${err instanceof Error ? err.message : String(err)}`)
    }

    // 4. Format inbound envelope — try new API, fallback to raw text
    let body = promptText
    try {
      if (runtime?.channel?.reply?.formatInboundEnvelope) {
        const envelopeOptions = runtime.channel.reply.resolveEnvelopeFormatOptions?.(cfg) ?? {}
        let previousTimestamp
        if (storePath && runtime.channel.session?.readSessionUpdatedAt) {
          previousTimestamp = runtime.channel.session.readSessionUpdatedAt({
            storePath,
            sessionKey: route.sessionKey
          })
        }
        body = runtime.channel.reply.formatInboundEnvelope({
          channel: CHANNEL_ID,
          from: userId || sessionId,
          timestamp: Date.now(),
          body: promptText,
          chatType: 'direct',
          sender: { id: userId || sessionId },
          previousTimestamp,
          envelope: envelopeOptions
        })
        ctx.log?.info?.(`[${CHANNEL_ID}] formatInboundEnvelope OK`)
      }
    } catch (err) {
      ctx.log?.warn?.(`[${CHANNEL_ID}] formatInboundEnvelope failed: ${err instanceof Error ? err.message : String(err)}; using raw text`)
      body = promptText
    }

    // 5. Build message context via finalizeInboundContext
    const rt = runtime?.channel ?? ctx.channelRuntime
    if (!rt?.reply?.finalizeInboundContext) {
      ctx.log?.error?.(`[${CHANNEL_ID}] no finalizeInboundContext available; cannot process prompt`)
      activeTurns.delete(promptId)
      return
    }

    const from = `${CHANNEL_ID}:${userId || sessionId}`
    const msgCtx = rt.reply.finalizeInboundContext({
      Body: body,
      RawBody: promptText,
      BodyForAgent: body,
      CommandBody: promptText,
      From: from,
      To: from,
      SessionKey: route.sessionKey,
      AccountId: route.accountId,
      OriginatingChannel: CHANNEL_ID,
      OriginatingTo: from,
      ChatType: 'direct',
      SenderName: ctx.account?.name || 'WeChat Access',
      SenderId: userId || from,
      Provider: CHANNEL_ID,
      Surface: CHANNEL_ID,
      ConversationLabel: ctx.account?.name || 'WeChat Access',
      Timestamp: Date.now(),
      CommandAuthorized: true
    })

    // 6. Record session meta (fire-and-forget, non-blocking)
    if (storePath && runtime?.channel?.session?.recordSessionMetaFromInbound) {
      void runtime.channel.session.recordSessionMetaFromInbound({
        storePath,
        sessionKey: route.sessionKey,
        ctx: msgCtx
      }).catch((err) => {
        ctx.log?.warn?.(`[${CHANNEL_ID}] recordSessionMetaFromInbound failed: ${err instanceof Error ? err.message : String(err)}`)
      })
    }

    // 7. Record inbound activity
    if (runtime?.channel?.activity?.record) {
      runtime.channel.activity.record({
        channel: CHANNEL_ID,
        accountId: route.accountId || DEFAULT_ACCOUNT_ID,
        direction: 'inbound'
      })
    }

    // 8. Subscribe to agent events for streaming
    let lastEmittedText = ''
    let toolCallCounter = 0

    const unsubscribe = await subscribeAgentEvent((evt) => {
      if (turn.cancelled) return
      if (evt.sessionKey && evt.sessionKey !== route.sessionKey) return

      const data = evt.data || {}

      // --- assistant stream: text chunks ---
      if (evt.stream === 'assistant') {
        const delta = data.delta
        const text = data.text

        let textToSend = delta
        if (!textToSend && text && text !== lastEmittedText) {
          textToSend = text.slice(lastEmittedText.length)
          lastEmittedText = text
        } else if (delta) {
          lastEmittedText += delta
        }

        if (textToSend) {
          sendEnvelope(ws, 'session.update', {
            session_id: sessionId,
            prompt_id: promptId,
            update_type: 'message_chunk',
            content: { type: 'text', text: textToSend }
          }, guid, userId)
        }
        return
      }

      // --- tool stream: tool calls ---
      if (evt.stream === 'tool') {
        const phase = data.phase
        const toolName = data.name
        const toolCallId = data.toolCallId || `tc-${++toolCallCounter}`

        if (phase === 'start') {
          sendEnvelope(ws, 'session.update', {
            session_id: sessionId,
            prompt_id: promptId,
            update_type: 'tool_call',
            tool_call: {
              tool_call_id: toolCallId,
              title: toolName,
              kind: mapToolKind(toolName),
              status: 'in_progress'
            }
          }, guid, userId)
        } else if (phase === 'update') {
          sendEnvelope(ws, 'session.update', {
            session_id: sessionId,
            prompt_id: promptId,
            update_type: 'tool_call_update',
            tool_call: {
              tool_call_id: toolCallId,
              title: toolName,
              status: 'in_progress',
              content: data.text ? [{ type: 'text', text: data.text }] : undefined
            }
          }, guid, userId)
        } else if (phase === 'result') {
          sendEnvelope(ws, 'session.update', {
            session_id: sessionId,
            prompt_id: promptId,
            update_type: 'tool_call_update',
            tool_call: {
              tool_call_id: toolCallId,
              title: toolName,
              status: data.isError ? 'failed' : 'completed',
              content: data.result ? [{ type: 'text', text: data.result }] : undefined
            }
          }, guid, userId)
        }
        return
      }
    })

    turn.unsubscribe = unsubscribe

    // 9. Dispatch to agent
    const messagesConfig = rt.reply.resolveEffectiveMessagesConfig?.(cfg, route.agentId) ?? {}

    let finalText = null
    await rt.reply.dispatchReplyWithBufferedBlockDispatcher({
      ctx: msgCtx,
      cfg,
      dispatcherOptions: {
        responsePrefix: messagesConfig.responsePrefix,
        deliver: async (deliverPayload, info) => {
          if (turn.cancelled) return

          ctx.log?.info?.(`[${CHANNEL_ID}] agent ${info?.kind || 'unknown'} reply: ${deliverPayload?.text?.slice(0, 50) || '(no text)'}`)

          if (deliverPayload?.text) {
            finalText = deliverPayload.text
          }

          // Record outbound activity
          if (runtime?.channel?.activity?.record) {
            runtime.channel.activity.record({
              channel: CHANNEL_ID,
              accountId: route.accountId || DEFAULT_ACCOUNT_ID,
              direction: 'outbound'
            })
          }
        },
        onReplyStart: () => {
          ctx.log?.info?.(`[${CHANNEL_ID}] reply start session=${sessionId}`)
        },
        onError: (err, info) => {
          ctx.log?.error?.(`[${CHANNEL_ID}] agent ${info?.kind || 'unknown'} error: ${err instanceof Error ? err.message : String(err)}`)
        }
      },
      replyOptions: {}
    })

    // 10. Cleanup and send final response
    unsubscribe()
    activeTurns.delete(promptId)

    if (turn.cancelled) {
      sendEnvelope(ws, 'session.promptResponse', {
        session_id: sessionId,
        prompt_id: promptId,
        stop_reason: 'cancelled'
      }, guid, userId)
      return
    }

    const replyText = finalText || (lastEmittedText.trim() ? lastEmittedText : null)
    const responseContent = replyText ? [{ type: 'text', text: replyText }] : []

    sendEnvelope(ws, 'session.promptResponse', {
      session_id: sessionId,
      prompt_id: promptId,
      stop_reason: 'end_turn',
      content: responseContent
    }, guid, userId)

    ctx.log?.info?.(`[${CHANNEL_ID}] prompt done promptId=${promptId} hasReply=${!!replyText} finalText=${!!finalText} streamedLen=${lastEmittedText.length}`)
  } catch (err) {
    ctx.log?.error?.(`[${CHANNEL_ID}] prompt failed: ${err instanceof Error ? err.message : String(err)}`)

    const currentTurn = activeTurns.get(promptId)
    currentTurn?.unsubscribe?.()
    activeTurns.delete(promptId)

    sendEnvelope(ws, 'session.promptResponse', {
      session_id: sessionId,
      prompt_id: promptId,
      stop_reason: 'error',
      error: err instanceof Error ? err.message : String(err)
    }, guid, userId)
  }
}

// ============================================
// handleCancel — aligned with official message-handler.ts
// ============================================
function handleCancel({ ctx, ws, message }) {
  const { payload } = message || {}
  const sessionId = payload?.session_id || ''
  const promptId = payload?.prompt_id || ''
  const guid = String(message?.guid ?? '')
  const userId = String(message?.user_id ?? '')

  ctx.log?.info?.(`[${CHANNEL_ID}] 收到 cancel promptId=${promptId}`)

  const turn = activeTurns.get(promptId)
  if (!turn) {
    ctx.log?.warn?.(`[${CHANNEL_ID}] cancel: 未找到活跃 Turn ${promptId}`)
    sendEnvelope(ws, 'session.promptResponse', {
      session_id: sessionId,
      prompt_id: promptId,
      stop_reason: 'cancelled'
    }, guid, userId)
    return
  }

  turn.cancelled = true
  turn.unsubscribe?.()
  activeTurns.delete(promptId)

  sendEnvelope(ws, 'session.promptResponse', {
    session_id: sessionId,
    prompt_id: promptId,
    stop_reason: 'cancelled'
  }, guid, userId)

  ctx.log?.info?.(`[${CHANNEL_ID}] Turn 已取消: ${promptId}`)
}

// ============================================
// Plugin definition
// ============================================
export const wechatAccessPlugin = {
  id: CHANNEL_ID,
  meta: {
    id: CHANNEL_ID,
    label: 'OpenClaw WeChat Access Plugin',
    selectionLabel: 'OpenClaw WeChat Access Plugin',
    detailLabel: 'WeCom remote control',
    blurb: 'Receive WeCom remote-control prompts and reply from OpenClaw.',
    order: 95,
    showConfigured: true
  },
  capabilities: {
    chatTypes: ['direct'],
    reactions: false,
    threads: false,
    media: true,
    nativeCommands: false,
    blockStreaming: false
  },
  reload: {
    configPrefixes: [`channels.${CHANNEL_ID}`]
  },
  configSchema: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        enabled: { type: 'boolean' },
        name: { type: 'string' },
        token: { type: 'string' },
        wsUrl: { type: 'string' },
        guid: { type: 'string' },
        userId: { oneOf: [{ type: 'string' }, { type: 'number' }] },
        environment: { type: 'string' },
        authStatePath: { type: 'string' },
        bypassInvite: { type: 'boolean' }
      }
    },
    uiHints: {
      token: { label: 'Channel Token', sensitive: true },
      wsUrl: { label: 'WS URL' },
      guid: { label: 'GUID' },
      userId: { label: 'User ID' },
      environment: { label: 'Environment (production/test)' }
    }
  },
  config: {
    listAccountIds: () => [DEFAULT_ACCOUNT_ID],
    resolveAccount: (cfg, accountId) => resolveAccount(cfg, accountId || DEFAULT_ACCOUNT_ID),
    defaultAccountId: () => DEFAULT_ACCOUNT_ID,
    isEnabled: (account) => account.enabled !== false,
    isConfigured: (account) => Boolean(account.token && account.wsUrl),
    unconfiguredReason: () => 'missing token/wsUrl',
    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: Boolean(account.token && account.wsUrl),
      linked: Boolean(account.token),
      selfId: String(account.userId || '')
    })
  },
  commands: {
    enforceOwnerForCommands: true,
    skipWhenConfigEmpty: true
  },

  // --- outbound adapter (required by new framework) ---
  outbound: {
    deliveryMode: 'direct',
    sendText: async () => ({ ok: true })
  },

  // --- status adapter ---
  status: {
    buildAccountSnapshot: ({ accountId }) => {
      return { running: accountRunning.get(accountId || DEFAULT_ACCOUNT_ID) || false }
    }
  },

  gateway: {
    startAccount: async (ctx) => {
      const channelCfg = getChannelConfig(ctx.cfg)
      let token = channelCfg.token || ''
      const configWsUrl = channelCfg.wsUrl || ''
      const authStatePath = channelCfg.authStatePath ? String(channelCfg.authStatePath) : undefined
      const envName = channelCfg.environment ? String(channelCfg.environment) : 'production'

      const env = getEnvironment(envName)
      const guid = channelCfg.guid || getDeviceGuid()
      const wsUrl = configWsUrl || env.wechatWsUrl

      ctx.log?.info?.(`[${CHANNEL_ID}] starting account=${ctx.accountId} hasToken=${!!token} hasUrl=${!!wsUrl} guid=${guid.slice(0, 6)}...`)

      // Token strategy: config > saved auth state > prompt user to login
      const savedState = loadState(authStatePath)
      if (!token && savedState?.channelToken) {
        token = savedState.channelToken
        ctx.log?.info?.(`[${CHANNEL_ID}] using saved token: ${token.slice(0, 6)}...`)
      }

      if (!token) {
        ctx.log?.warn?.(`[${CHANNEL_ID}] no token found; launching terminal login bootstrap`)
        launchTerminalBootstrap(ctx)
        return new Promise((resolve) => {
          ctx.abortSignal.addEventListener('abort', () => resolve(), { once: true })
        })
      }

      // Token refresh: use jwt_token to call 4058 API for fresh channel_token
      const jwtToken = savedState?.jwtToken || ''
      if (jwtToken) {
        const api = new QClawAPI(env, guid, jwtToken)
        api.userId = String(savedState?.userInfo?.user_id ?? channelCfg.userId ?? '')
        const savedLoginKey = savedState?.userInfo?.loginKey
        if (savedLoginKey) api.loginKey = savedLoginKey

        let refreshed = false
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const newToken = await api.refreshChannelToken()
            if (newToken) {
              token = newToken
              ctx.log?.info?.(`[${CHANNEL_ID}] channel_token refreshed: ${token.slice(0, 6)}...`)
              // Update saved state
              if (savedState) {
                savedState.channelToken = newToken
                savedState.savedAt = Date.now()
                saveState(savedState, authStatePath)
              }
              // Update openclaw.json config
              try {
                const runtime = getRuntime()
                if (runtime?.config?.loadConfig && runtime?.config?.writeConfigFile) {
                  const fullCfg = runtime.config.loadConfig()
                  const channels = { ...(fullCfg.channels ?? {}) }
                  channels[CHANNEL_ID] = { ...(channels[CHANNEL_ID] ?? {}), token: newToken }
                  await runtime.config.writeConfigFile({ ...fullCfg, channels })
                }
              } catch { /* non-fatal */ }
              refreshed = true
              break
            }
          } catch (e) {
            if (e instanceof TokenExpiredError) {
              clearState(authStatePath)
              ctx.log?.warn?.(`[${CHANNEL_ID}] jwt_token expired, please re-login`)
              launchTerminalBootstrap(ctx)
              return new Promise((resolve) => {
                ctx.abortSignal.addEventListener('abort', () => resolve(), { once: true })
              })
            }
            ctx.log?.warn?.(`[${CHANNEL_ID}] token refresh failed (${attempt + 1}/3): ${e instanceof Error ? e.message : String(e)}`)
          }
          if (attempt < 2) await new Promise(r => setTimeout(r, 1500))
        }
        if (!refreshed) {
          ctx.log?.info?.(`[${CHANNEL_ID}] token refresh failed, using existing token`)
        }
      }

      // Get userId from config or saved state
      const userId = channelCfg.userId
        ? String(channelCfg.userId)
        : String(savedState?.userInfo?.user_id ?? '')

      const account = {
        accountId: ctx.accountId || DEFAULT_ACCOUNT_ID,
        token,
        wsUrl,
        guid,
        userId,
        name: channelCfg.name || 'WeChat Access'
      }

      ctx.log?.info?.(`[${CHANNEL_ID}] connecting with guid=${guid.slice(0, 6)}... userId=${userId || '(empty)'} token=${token.slice(0, 6)}...`)

      // Track running state and notify framework
      accountRunning.set(ctx.accountId, true)
      ctx.setStatus?.({ running: true })

      try {
        await runWechatWsClient({
          account,
          abortSignal: ctx.abortSignal,
          log: ctx.log,
          onPrompt: ({ ws, message }) => handlePrompt({ ctx, ws, message }),
          onCancel: ({ ws, message }) => handleCancel({ ctx, ws, message })
        })
      } finally {
        accountRunning.set(ctx.accountId, false)
        ctx.setStatus?.({ running: false })
      }
    },
    stopAccount: async (ctx) => {
      accountRunning.set(ctx.accountId, false)
      ctx.setStatus?.({ running: false })
      ctx.log?.info?.(`[${CHANNEL_ID}] stopped account=${ctx.accountId}`)
    }
  },
  agentPrompt: {
    messageToolHints: () => [
      '- Replies in this channel go back to the bound WeChat controller account.',
      '- Keep responses concise and avoid markdown-heavy formatting.'
    ]
  }
}
