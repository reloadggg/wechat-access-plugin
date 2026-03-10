import { wechatAccessPlugin, setPluginRuntime } from './src/channel.js'
import { registerWechatAccessCli } from './src/cli.js'

const plugin = {
  id: 'openclaw-wechat-access-plugin',
  name: 'OpenClaw WeChat Access Plugin',
  description: 'WeCom-based remote control channel for OpenClaw.',
  configSchema: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {}
    }
  },
  register(api) {
    setPluginRuntime(api.runtime)
    api.registerChannel({ plugin: wechatAccessPlugin })
    api.registerCli(({ program, config }) => {
      registerWechatAccessCli({ program, logger: api.logger, config })
    }, { commands: ['wechat-access'] })
  }
}

export default plugin
