# @fengcch/openclaw-wechat-access-plugin

一个给 OpenClaw 用的微信接入插件。

它做的事情很直接：

- 安装到 OpenClaw 插件系统
- 启用后提供微信登录入口
- 帮你拿到 token
- 打印绑定设备链接
- 完成绑定后，让你可以用微信控制 OpenClaw

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

默认推荐终端二维码方案：

```bash
openclaw wechat-access login
```

如果终端二维码方案不稳定，再用浏览器备用方案：

```bash
openclaw wechat-access login-browser
```

只想显示二维码并输出 token JSON：

```bash
openclaw wechat-access qr
```

查看插件状态建议：

```bash
openclaw wechat-access status
openclaw status
```

## 用户需要做什么

整个流程里，目前用户还需要自己完成两步：

1. 用微信扫码并在手机上确认登录
2. 用控制端微信打开终端打印出来的绑定链接

完成后，终端会提示你重启 OpenClaw。

## 成功标志

完成安装和绑定后：

- `openclaw status` 里这个渠道不再只是 `SETUP`
- 控制端微信发消息时，OpenClaw 能回复

## 常见问题

- 没装上：重新执行 `openclaw plugins install @fengcch/openclaw-wechat-access-plugin`
- 没弹登录：手动执行 `openclaw wechat-access login`
- 终端二维码不好用：改用 `openclaw wechat-access login-browser`
- 绑定后还是离线：先重启 OpenClaw，再测试一次

## 当前状态

当前已经具备这些能力：

- OpenClaw 插件安装
- OpenClaw 命令入口
- 终端二维码登录原型
- 浏览器扫码登录备用方案
- 自动写配置
- 自动打印绑定链接

## 免责声明

本项目基于第三方客户端行为和接口链路做兼容实现，不是官方 SDK，也不是官方授权集成。

- 更适合学习、研究、个人测试和兼容性验证
- 上游接口变更后，扫码、绑定、消息收发都可能失效
- 使用本项目带来的账号、服务、合规等风险需自行承担
