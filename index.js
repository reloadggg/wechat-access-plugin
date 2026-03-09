import { wechatAccessPlugin } from './src/channel.js'

const plugin = {
  id: 'wechat-access',
  name: 'WeChat Access',
  description: 'WeCom-based remote control channel for OpenClaw.',
  configSchema: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {}
    }
  },
  register(api) {
    api.registerChannel({ plugin: wechatAccessPlugin })
  }
}

export default plugin
