import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

function resolveDefaultConfigPath() {
  if (process.env.OPENCLAW_CONFIG) {
    return path.resolve(process.env.OPENCLAW_CONFIG)
  }
  if (process.env.OPENCLAW_HOME) {
    return path.join(path.resolve(process.env.OPENCLAW_HOME), 'openclaw.json')
  }
  return path.join(process.env.USERPROFILE || process.env.HOME || '.', '.openclaw', 'openclaw.json')
}

const CONFIG_PATH = resolveDefaultConfigPath()

function parseArgs(argv) {
  const args = {
    config: CONFIG_PATH,
    token: '',
    guid: '',
    userId: '',
    wsUrl: 'wss://mmgrcalltoken.3g.qq.com/agentwss',
    enable: true,
    help: false
  }

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') args.help = true
    else if (arg === '--config') args.config = argv[++i]
    else if (arg === '--token') args.token = argv[++i]
    else if (arg === '--guid') args.guid = argv[++i]
    else if (arg === '--user-id') args.userId = argv[++i]
    else if (arg === '--ws-url') args.wsUrl = argv[++i]
    else if (arg === '--disable') args.enable = false
    else throw new Error(`Unknown argument: ${arg}`)
  }

  return args
}

function printHelp() {
  console.log(`Usage:
  node scripts/apply-config.mjs --token TOKEN --guid GUID --user-id USER_ID

Options:
  --config PATH   OpenClaw config path
  --ws-url URL    WebSocket URL
  --disable       Write block but keep disabled
`)
}

function ensurePluginEnabled(config) {
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
}

async function main() {
  const args = parseArgs(process.argv)
  if (args.help) {
    printHelp()
    return
  }
  if (!(args.token && args.guid && args.userId)) {
    throw new Error('Missing required arguments: --token --guid --user-id')
  }

  const config = JSON.parse(await fs.readFile(args.config, 'utf8'))
  config.channels ||= {}
  config.channels['openclaw-wechat-access-plugin'] = {
    enabled: args.enable,
    name: 'OpenClaw WeChat Access Plugin',
    token: args.token,
    wsUrl: args.wsUrl,
    guid: args.guid,
    userId: String(args.userId),
    queryIdentityMode: 'token-only'
  }
  ensurePluginEnabled(config)

  await fs.writeFile(args.config, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  console.log(`Applied openclaw-wechat-access-plugin config to ${args.config}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
