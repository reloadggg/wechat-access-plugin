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

说明：扫码成功后，绑定链接生成可能存在几秒延迟；脚本会自动等待并重试，无需立刻手动重跑。

如果你希望用户只需要“扫码 -> 复制链接 -> 去微信点开”，请先在项目根目录放一个本地文件：

`wechat-access.local.json`

可参考：`wechat-access.local.example.json`

内容示例：

```json
{
  "loginKey": "m83qdao0AmE5",
  "serviceOpenId": "YOUR_FIXED_SERVICE_OPEN_ID"
}
```

其中 `serviceOpenId` 应该填写生成绑定链接所需的固定服务端 open_id/open_kfid，而不是当前扫码用户自己的 openid。

说明：

- `serviceOpenId` 通常对应这套绑定服务使用的固定客服入口/服务入口 ID
- 它一般不是每个用户都不同
- 真正每次因扫码而变化的是 `guid`、`userId`、`jwt_token` 和 `openclaw_channel_token`
- 如果把错误的“用户 openid”填进这里，绑定链接接口会返回无效参数错误

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
- 如果扫码成功但未出现绑定链接：优先检查 `wechat-access.local.json` 里的 `serviceOpenId` 是否已配置，再重新执行 `npm run setup`
- 如果绑定完成后仍无法收消息：重启 OpenClaw 后再测一次

## 手动生成绑定链接

如果自动流程没有打印绑定链接，可以手动执行：

```powershell
npm run bind-link -- --guid YOUR_GUID --user-id YOUR_USER_ID --jwt YOUR_JWT
```

脚本会：

1. 打印绑定链接
2. 轮询绑定状态
3. 绑定成功后提示你重启 OpenClaw

## 备注

- 当前流程是“控制台驱动 + 浏览器扫码”，不是纯终端扫码
- 安装完成后的最后一步一定要提示用户“重启 OpenClaw”
- 绑定链接生成依赖固定的服务端 `open_id/open_kfid`；推荐通过 `wechat-access.local.json` 提供
