import crypto from 'node:crypto'
import { runWechatWsClient } from './ws-client.js'

const CHANNEL_ID = 'wechat-access'
const DEFAULT_ACCOUNT_ID = 'main'

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

function createEnvelope({ message, method, payload }) {
  return {
    msg_id: crypto.randomUUID(),
    guid: String(message.guid),
    user_id: String(message.user_id),
    method,
    payload
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

function buildSessionKey(sessionId) {
  return `agent:main:${CHANNEL_ID}:dm:${sessionId}`
}

async function handlePrompt({ ctx, ws, message }) {
  const rt = ctx.channelRuntime
  if (!rt) {
    ctx.log?.warn?.('wechat-access missing channelRuntime; skip prompt handling')
    return
  }

  const promptText = extractPromptText(message)
  if (!promptText) {
    return
  }

  const sessionId = message?.payload?.session_id || crypto.randomUUID()
  const promptId = message?.payload?.prompt_id || crypto.randomUUID()
  const from = `${CHANNEL_ID}:${sessionId}`
  const sessionKey = buildSessionKey(sessionId)
  const currentCfg = ctx.runtime.config?.getSnapshot ? ctx.runtime.config.getSnapshot() : ctx.cfg
  const deliveredTexts = []

  const msgCtx = rt.reply.finalizeInboundContext({
    Body: promptText,
    RawBody: promptText,
    BodyForAgent: promptText,
    CommandBody: promptText,
    From: from,
    To: from,
    SessionKey: sessionKey,
    AccountId: ctx.accountId,
    OriginatingChannel: CHANNEL_ID,
    OriginatingTo: from,
    ChatType: 'direct',
    SenderName: ctx.account.name,
    SenderId: from,
    Provider: CHANNEL_ID,
    Surface: CHANNEL_ID,
    ConversationLabel: ctx.account.name,
    Timestamp: Date.now(),
    CommandAuthorized: true
  })

  await rt.reply.dispatchReplyWithBufferedBlockDispatcher({
    ctx: msgCtx,
    cfg: currentCfg,
    dispatcherOptions: {
      deliver: async (payload) => {
        const text = [payload?.text, payload?.body].filter(Boolean).join('\n').trim()
        if (!text) {
          return
        }
        deliveredTexts.push(text)
      },
      onReplyStart: () => {
        ctx.log?.info?.(`wechat-access reply start session=${sessionId}`)
      }
    }
  })

  const finalText = deliveredTexts.join('\n\n').trim() || 'Done.'
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(createEnvelope({
      message,
      method: 'session.promptResponse',
      payload: {
        session_id: sessionId,
        prompt_id: promptId,
        stop_reason: 'end_turn',
        content: [
          {
            type: 'text',
            text: finalText
          }
        ]
      }
    })))
  } else {
    ctx.log?.warn?.(`wechat-access ws closed before reply could be sent session=${sessionId}`)
  }
}

export const wechatAccessPlugin = {
  id: CHANNEL_ID,
  meta: {
    id: CHANNEL_ID,
    label: 'WeChat Access',
    selectionLabel: 'WeChat Access',
    detailLabel: 'WeCom remote control',
    blurb: 'Receive WeCom remote-control prompts and reply from OpenClaw.',
    order: 95,
    showConfigured: true
  },
  capabilities: {
    chatTypes: ['direct'],
    polls: false,
    reactions: false,
    media: false,
    edit: false,
    reply: true,
    threads: false
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
        userId: { oneOf: [{ type: 'string' }, { type: 'number' }] }
      }
    },
    uiHints: {
      token: { label: 'Channel Token', sensitive: true },
      wsUrl: { label: 'WS URL' },
      guid: { label: 'GUID' },
      userId: { label: 'User ID' }
    }
  },
  config: {
    listAccountIds: () => [DEFAULT_ACCOUNT_ID],
    resolveAccount: (cfg, accountId) => resolveAccount(cfg, accountId || DEFAULT_ACCOUNT_ID),
    defaultAccountId: () => DEFAULT_ACCOUNT_ID,
    isEnabled: (account) => account.enabled !== false,
    isConfigured: (account) => Boolean(account.token && account.wsUrl && account.guid && account.userId),
    unconfiguredReason: () => 'missing token/wsUrl/guid/userId',
    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: Boolean(account.token && account.wsUrl && account.guid && account.userId),
      linked: Boolean(account.token),
      selfId: String(account.userId || '')
    })
  },
  commands: {
    enforceOwnerForCommands: true,
    skipWhenConfigEmpty: true
  },
  gateway: {
    startAccount: async (ctx) => {
      const account = resolveAccount(ctx.cfg, ctx.accountId)
      if (!(account.token && account.wsUrl && account.guid && account.userId)) {
        ctx.log?.warn?.('wechat-access not fully configured; waiting for config')
        return new Promise((resolve) => {
          ctx.abortSignal.addEventListener('abort', () => resolve(), { once: true })
        })
      }

      ctx.log?.info?.(`wechat-access starting account=${ctx.accountId}`)
      return runWechatWsClient({
        account,
        abortSignal: ctx.abortSignal,
        log: ctx.log,
        onPrompt: ({ ws, message }) => handlePrompt({ ctx, ws, message })
      })
    },
    stopAccount: async (ctx) => {
      ctx.log?.info?.(`wechat-access stopped account=${ctx.accountId}`)
    }
  },
  agentPrompt: {
    messageToolHints: () => [
      '- Replies in this channel go back to the bound WeChat controller account.',
      '- Keep responses concise and avoid markdown-heavy formatting.'
    ]
  }
}
