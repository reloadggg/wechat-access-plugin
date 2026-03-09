# WeChat Access Plugin

## 项目目标

`wechat-access-plugin` 是一个独立的 OpenClaw 渠道插件项目，用于把第三方微信远程控制链路接入本地 OpenClaw，使控制端微信号可以向 OpenClaw 发送消息并接收回复。

当前项目主要包含：

- OpenClaw 渠道插件本体
- WebSocket 通道接入逻辑
- 控制台驱动的扫码取 token 工具
- 自动写入 `openclaw.json` 的辅助脚本
- 本地安装到 `.openclaw/extensions` 的安装脚本

## 当前能力

- 安装为独立 OpenClaw 插件
- 通过扫码登录获取 `openclaw_channel_token`
- 自动写入本地 OpenClaw 配置
- 建立微信远控 WebSocket 通道
- 接收控制端微信消息并回传 OpenClaw 回复

## 快速开始

推荐直接执行：

```powershell
cd <plugin-dir>
npm run setup
```

这会自动完成安装、扫码登录、配置写入和绑定流程初始化。

详细安装步骤请看：`INSTALL.zh-CN.md`

## 项目结构

- `index.js`：插件入口
- `src/channel.js`：渠道适配与消息桥接
- `src/ws-client.js`：WebSocket 长连接、重连与心跳
- `scripts/install-local.mjs`：安装插件到本地 OpenClaw
- `scripts/apply-config.mjs`：把 token/guid/userId 写入 `openclaw.json`
- `tools/token-cli/serve.mjs`：控制台驱动的扫码取 token 工具

## 免责声明

本项目是基于现有第三方客户端行为、接口与通信链路进行逆向分析后实现的兼容性插件，**不是官方 SDK、不是官方开放平台集成，也未获得原厂或相关服务提供方的正式授权声明**。

使用本项目时请注意：

- 本项目仅供学习、研究、个人测试与兼容性验证使用
- 请自行评估目标服务的用户协议、平台规则、法律合规与账号风险
- 由于上游接口、鉴权机制、绑定流程和协议细节可能随时变化，项目功能可能失效
- 因使用本项目导致的账号限制、服务异常、数据问题、封禁风险或其他损失，需由使用者自行承担
- 若你计划将其用于商业用途、团队环境或公开分发，建议先完成充分的合规与授权评估

## 风险说明

- 上游接口可能变更，导致扫码、绑定或消息收发失效
- 绑定流程依赖远端接口状态，不能保证每次都完全自动化
- 登录与远控能力依赖第三方服务存活，不属于本项目可控范围

## 建议

- 不要在公开仓库提交真实 token、jwt、guid、userId 等敏感配置
- 首次使用前先阅读 `INSTALL.zh-CN.md`
- 每次更新插件后重新执行 `npm run install-local`

## 补充说明

- 完整项目说明：`PROJECT.zh-CN.md`
- 安装执行说明：`INSTALL.zh-CN.md`
