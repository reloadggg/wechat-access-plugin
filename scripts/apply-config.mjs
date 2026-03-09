import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const CONFIG_PATH = path.join(process.env.USERPROFILE || process.env.HOME || '.', '.openclaw', 'openclaw.json')

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
  if (!config.plugins.allow.includes('wechat-access')) {
    config.plugins.allow.push('wechat-access')
  }
  config.plugins.entries ||= {}
  config.plugins.entries['wechat-access'] = {
    ...(config.plugins.entries['wechat-access'] || {}),
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
  config.channels['wechat-access'] = {
    enabled: args.enable,
    name: 'WeChat Access',
    token: args.token,
    wsUrl: args.wsUrl,
    guid: args.guid,
    userId: String(args.userId)
  }
  ensurePluginEnabled(config)

  await fs.writeFile(args.config, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  console.log(`Applied wechat-access config to ${args.config}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
