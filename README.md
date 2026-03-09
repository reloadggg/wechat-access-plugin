# OpenClaw WeChat Access Plugin

这是一个给 OpenClaw 用的微信接入插件实验版。

目标很简单：

- 安装插件
- 启用渠道
- 登录微信
- 拿到绑定链接
- 在微信里点开绑定
- 然后就能用微信控制 OpenClaw

整个流程尽量做成“看得懂、跟着做就行”。

## 最推荐的用法

如果你已经在这个项目目录里，先安装插件：

```bash
openclaw plugins install .
```

然后启用渠道：

```bash
openclaw config set channels.openclaw-wechat-access-plugin.enabled true
```

接着手动触发登录：

```bash
openclaw wechat-access login
```

如果一切顺利，你会看到：

1. 终端直接显示微信二维码
2. 你扫码并在手机上确认
3. 终端自动写入配置
4. 终端打印“绑定设备链接”
5. 你把这个链接复制到控制端微信里打开
6. 绑定成功后，终端提示你重启 OpenClaw

## 如果终端二维码不稳定

可以改用浏览器登录方案：

```bash
openclaw wechat-access login-browser
```

这个命令会自动打开浏览器扫码页，其他流程基本一样。

## 常用命令

安装插件：

```bash
openclaw plugins install .
```

启用渠道：

```bash
openclaw config set channels.openclaw-wechat-access-plugin.enabled true
```

终端二维码登录：

```bash
openclaw wechat-access login
```

浏览器登录备用方案：

```bash
openclaw wechat-access login-browser
```

只显示二维码并输出 token JSON：

```bash
openclaw wechat-access qr
```

看状态说明：

```bash
openclaw wechat-access status
openclaw status
```

## 用户需要自己做的动作

有两步目前还必须人工完成：

1. 用微信扫码并在手机上确认登录
2. 用控制端微信打开终端打印出来的绑定链接

这两步做完以后，插件才能真正进入“在线可控”的状态。

## 什么时候算成功

你完成安装和绑定后：

- `openclaw status` 里这个渠道不再只是 `SETUP`
- 控制端微信给 OpenClaw 发消息时，能收到回复

## 如果没成功

- 没装上：重新执行 `openclaw plugins install .`
- 没弹登录：手动执行 `openclaw wechat-access login`
- 终端二维码不好用：改用 `openclaw wechat-access login-browser`
- 绑定后还是离线：重启 OpenClaw 再试一次

## 当前实现状态

这还是一个实验版，但下面这些已经能工作：

- `openclaw plugins install .`
- `openclaw config set channels.openclaw-wechat-access-plugin.enabled true`
- `openclaw wechat-access ...` 命令入口
- 终端二维码登录原型
- 浏览器扫码登录备用方案
- 自动写配置
- 自动打印绑定链接

## 免责声明

本项目是基于第三方客户端行为和接口链路做的兼容实现，不是官方 SDK，也不是官方授权集成。

- 更适合学习、研究、个人测试和兼容性验证
- 上游接口变更后，扫码、绑定、消息收发都可能失效
- 使用本项目带来的账号、服务、合规等风险需自行承担
