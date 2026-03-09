# WeChat Access Plugin

这是一个给 OpenClaw 用的微信远控插件。

装好以后，你可以：

- 用微信扫码完成登录
- 让终端自动打印“绑定设备链接”
- 用控制端微信打开这个链接完成绑定
- 之后直接用微信给 OpenClaw 发消息

## 一句话安装

在项目目录执行：

```powershell
cd <plugin-dir>
npm run setup
```

## 安装时会发生什么

`npm run setup` 会自动做这些事：

1. 把插件安装到 `~/.openclaw/extensions/wechat-access`
2. 打开微信扫码页
3. 扫码成功后把配置写入 `~/.openclaw/openclaw.json`
4. 生成绑定设备链接
5. 在终端打印绑定链接和绑定状态

## 你需要做什么

用户只需要跟着做这几步：

1. 在浏览器里完成微信扫码
2. 复制终端打印出来的绑定链接
3. 用控制端微信打开这个链接
4. 看到绑定完成后，重启 OpenClaw
5. 用控制端微信发一条消息测试

## 常用命令

一键安装：

```powershell
npm run setup
```

只安装插件：

```powershell
npm run install-local
```

只扫码取 token：

```powershell
npm run token
```

手动生成绑定链接：

```powershell
npm run bind-link -- --guid YOUR_GUID --user-id YOUR_USER_ID --jwt YOUR_JWT
```

## 如果没成功

- 没装上：重新执行 `npm run install-local`
- 扫码成功但没看到绑定链接：重新执行 `npm run setup`
- 绑定后还是收不到消息：先重启 OpenClaw，再测试一次

## 说明

- 当前项目已经内置了和原客户端一致的默认绑定服务入口
- 普通用户不需要自己再找 `serviceOpenId`
- 如果你要覆盖默认入口，可以再看 `INSTALL.zh-CN.md`

## 风险与免责声明

本项目是基于第三方客户端行为与接口链路做的兼容实现，不是官方 SDK，也不是官方授权集成。

- 仅建议用于学习、研究、个人测试与兼容性验证
- 上游接口变更后，扫码、绑定或消息收发都可能失效
- 使用本项目带来的账号、服务、合规等风险需自行承担

## 进一步阅读

- 安装说明：`INSTALL.zh-CN.md`
- 项目说明：`PROJECT.zh-CN.md`
