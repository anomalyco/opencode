# OpenCode IM Integration

将即时通讯平台（如 Telegram）与 OpenCode AI 助手集成，让你在手机端即可直接控制并与你的本地项目进行对话。

## 功能特性

- **💬 多项目支持与无缝切换**：支持配置多个本地项目，通过聊天命令快速无缝切换当前 AI 工作区上下文。
- **📷 图像视觉与媒体支持**：支持发送本地报错截图或结构图让 AI 分析（最大支持 20MB），内置存储清理机制。
- **🔐 隐私与白名单防刷**：可配置 Telegram 的用户 ID (userId) 白名单，防止陌生人或其他人调用你的本地资源。
- **⚡ 会话压缩与长效管理**：当聊天变长影响 Token 开销时，会自动压缩历史记录并通知用户减轻资源使用。

目前优先支持 **Telegram** 🤖，未来计划拓展至 Slack、WhatsApp、Discord 等平台。

---

## 快速开始 🚀

### 1. 准备你的 Telegram 机器人

#### 第一步：获取 Telegram Bot Token
1. 在 Telegram 中搜索 [@BotFather](https://t.me/botfather) 开始对话。
2. 发送 `/newbot` 创建一个新的机器人。
3. 按提示设置好机器人名称。完成后，你会获取到一个类似于 `123456789:ABCDEF-xxxxxxxxx` 的 Token。请妥善保存。

#### 第二步：获取你的获取用户 ID (User ID) 白名单
1. 在 Telegram 搜索 [@userinfobot](https://t.me/userinfobot) 或者 `@getmyid_bot`。
2. 点击 Start 或发消息，机器人会返回你的个人数字 ID，如：`123456789`。
3. 把这个数字记下来，这是你允许自己连接本地项目的唯一白名单凭证。

### 2. 初始化配置文件

配置文件通常放在你启动程序的目录（即当前工作区）或你的根目录下，命名为 ***`.opencode.json`***（如果是旧版本，可能是 `.opencode/opencode.json`）。

在你的 OpenCode 根目录或者你想存放的项目目录下创建并完善 `.opencode.json`。下面是一个带有**多项目管理**和配置的完整示例：

```json
{
  "projects": {
    "myproject": {
      "name": "我的主项目",
      "directory": "/Users/xxx/projects/myproject"
    },
    "opencode": {
      "name": "OpenCode 本身",
      "directory": "/Users/xxx/projects/opencode"
    }
  },
  "model": "zai-coding-plan/glm-4.7",
  "im": {
    "type": "telegram",
    "token": "你的_TELEGRAM_BOT_TOKEN",
    "allowedUsers": [
      123456789
    ],
    "maxFileSize": 20971520,
    "cleanupDays": 15
  }
}
```

*🔔 提示：`projects` 内的第一项将默认作为启动时载入的初始目录。`allowedUsers` 数组里需要填入你刚获取的数字类型 Telegram ID。若不写将允许任何找到这个 Bot 的人操作你的终端引擎（非常不推荐）！*

### 3. 运行服务

配置完成后，请到你的 OpenCode 源码主程序目录下唤起核心 `serve` 服务，它不仅会启动后端的引擎支持，同时还会自动建立与 Telegram 的双工连接。

```bash
# 如果是从源码启动：
cd packages/opencode
bun install

# 唤起本地服务以及对应的 IM 后台机器人
bun run src/index.ts serve
```

若启动成功，你的终端将输出类似如下日志：
```text
opencode server listening on http://127.0.0.1:52562
📱 Loading IM integration from: @opencode-ai/im-integration/manager
...
🔄 Connecting to opencode server on http://127.0.0.1:52562... (attempt 1/5)
✅ Connected to opencode server, default directory: /Users/xxx/projects/myproject
🤖 Creating Telegram bot with token...
🚀 IM integration initialized
```

### 4. 尽情探索

现在，回到 Telegram，找属于你自己的那个机器人，点击 Start 或向它发送 `hi`，即可让 AI 连接上你的代码库。

你也可以利用内置斜杠命令进行多项目管理：

| 可用内置命令                     | 功能说明                 |
| ------------------------ | -------------------- |
| `/help`                  | 显示指令帮助菜单             |
| `/list_projects`         | 列出来自 `.opencode.json` 中配置的所有支持项目 |
| `/switch_project <name>` | 将机器人的控制权和 AI 环境平滑切换到你指定的其他项目  |
| `/session_info`          | 显示当前项目所在会话、ID及收发消息数状态栏  |

> 💡 **进阶用法**：你可以随时发送一张截图给它，AI 将结合图像结构以及当前本地项目的实际代码，直接在 Telegram 与你对谈，协助查错！

---

## 更多高阶配置项参考

| JSON 字段路径 | 类型 | 说明 | 备注说明 |
| --- | --- | --- | --- |
| `im.enabled` | `boolean` | 是否开启机器人 | 默认 `true`（也可通过将其设为 `false` 暂时关闭 IM 模块） |
| `im.type` | `string` | 使用的即时通讯平台 | 当前默认且需填入 `"telegram"` |
| `im.token` | `string` | 平台申请的 Bot 凭证 | 就是通过 BotFather 获取的 Token |
| `im.allowedUsers`| `[number]` | 操作白名单 | 仅包含此数组内 UserId 的人才能命令机器人处理项目，极其重要！ |
| `im.storagePath` | `string` | 媒体附件暂存处 | 本地用来存储接收到的图片/文件等，默认会自动处理。 |
