# wechat-access 安装说明

这份文档是给 OpenClaw/Claude 直接执行安装流程用的。

## 目标

完成一次从零开始的安装与初始化，让用户只需要：

1. 在浏览器里完成微信扫码登录
2. 在微信里打开终端打印出的绑定链接
3. 完成后重启 OpenClaw

## 执行命令

在项目目录执行：

```powershell
cd <plugin-dir>
npm run setup
```

## 这条命令会自动做什么

`npm run setup` 会自动：

1. 把插件安装到 `~/.openclaw/extensions/wechat-access`
2. 启动本地 helper 并自动打开扫码页面
3. 登录成功后把 `token/guid/userId` 写入 `~/.openclaw/openclaw.json`
4. 尝试生成绑定设备链接
5. 在终端打印绑定链接和绑定状态

## 安装过程中的用户动作

OpenClaw/Claude 在执行时，应提示用户按下面顺序操作：

1. 浏览器中完成微信扫码登录
2. 如果终端打印出绑定链接，用控制端微信号打开这个链接
3. 等待终端出现绑定成功或绑定状态输出
4. 提示用户重启 OpenClaw
5. 重启后让用户用控制端微信号发送一条消息测试

## 成功标准

满足以下条件即可认为安装完成：

1. `npm run setup` 成功执行
2. `openclaw.json` 中出现 `channels.wechat-access`
3. `plugins.allow` 和 `plugins.entries.wechat-access` 已启用
4. 用户完成扫码与绑定
5. 提示用户重启 OpenClaw

## 如果失败怎么处理

- 如果插件未安装成功：重新执行 `npm run install-local`
- 如果扫码成功但未出现绑定链接：重新执行 `npm run setup`
- 如果绑定完成后仍无法收消息：重启 OpenClaw 后再测一次

## 备注

- 当前流程是“控制台驱动 + 浏览器扫码”，不是纯终端扫码
- 安装完成后的最后一步一定要提示用户“重启 OpenClaw”
