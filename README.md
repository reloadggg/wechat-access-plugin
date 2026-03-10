# @fengcch/openclaw-wechat-access-plugin

一个给 OpenClaw 用的微信接入插件。

它做的事情很直接：

- 安装到 OpenClaw 插件系统
- 终端二维码扫码登录，全自动轮询完成
- 获取 jwt_token 和 channel_token，gateway 启动时自动刷新
- 自动设备绑定
- 通过 WebSocket 接收微信消息，调用 agent 并回复

## 安装

推荐直接通过 OpenClaw 安装：

```bash
openclaw plugins install @fengcch/openclaw-wechat-access-plugin
```

启用渠道：

```bash
openclaw config set channels.openclaw-wechat-access-plugin.enabled true
```

然后重启 OpenClaw / Gateway。

## 登录

安装后可以直接用 OpenClaw 命令触发登录。

**推荐：终端二维码方案**（自动轮询，无需浏览器）：

```bash
openclaw wechat-access login
```

终端会直接渲染二维码，用微信扫码并确认后自动完成登录、token 获取和设备绑定。

**备用：浏览器方案**（终端二维码方案不稳定时使用）：

```bash
openclaw wechat-access login-browser
```

清除登录态：

```bash
openclaw wechat-access logout
```

查看插件状态建议：

```bash
openclaw wechat-access status
openclaw status
```

## 用户需要做什么

整个流程里，用户只需要：

1. 用微信扫描终端显示的二维码，并在手机上确认登录
2. 如提示需要绑定，用控制端微信打开绑定链接

完成后，终端会提示你重启 OpenClaw。

## Token 刷新机制

登录后 jwt_token 会保存到 `~/.openclaw/wechat-access-auth.json`。每次 gateway 启动时，插件会用 jwt_token 自动刷新 channel_token，无需重新扫码。

## 成功标志

完成安装和绑定后：

- `openclaw status` 里这个渠道不再只是 `SETUP`
- 控制端微信发消息时，OpenClaw 能回复

## 常见问题

- 没装上：重新执行 `openclaw plugins install @fengcch/openclaw-wechat-access-plugin`
- 没弹登录：手动执行 `openclaw wechat-access login`
- 终端二维码不好用：改用 `openclaw wechat-access login-browser`
- 绑定后还是离线：先重启 OpenClaw，再测试一次
- WebSocket 1006 断连：执行 `openclaw wechat-access login` 重新登录获取新 token

## 免责声明

本项目基于第三方客户端行为和接口链路做兼容实现，不是官方 SDK，也不是官方授权集成。

- 更适合学习、研究、个人测试和兼容性验证
- 上游接口变更后，扫码、绑定、消息收发都可能失效
- 使用本项目带来的账号、服务、合规等风险需自行承担
