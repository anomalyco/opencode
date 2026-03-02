# OpenCode IM Integration

将即时通讯平台与 OpenCode AI 助手集成。

## 功能特性

### 📷 媒体支持

- 支持所有媒体类型：photo, document, audio, video, voice, video_note
- 文件大小限制：20MB
- MIME 类型白名单
- 本地存储，自动清理（15天）

### 💬 会话管理

- 每个 Chat 自动创建会话
- 自动压缩并通知
- 项目切换命令

### 🔐 用户认证

- Telegram 用户 ID 白名单
- 可配置允许的用户

### 🎯 支持的平台

- Telegram
- Slack (开发中)
- WhatsApp (计划中)
- Discord (计划中)

## 安装方法

### 方法1：从源码运行（开发模式）

1. 克隆仓库并安装依赖：

```bash
cd /path/to/opencode/packages/opencode
bun install
```

2. 配置文件：
   在你的项目目录下创建 `.opencode.json`：

```json
{
  "im": {
    "type": "telegram",
    "token": "YOUR_BOT_TOKEN",
    "enabled": true
  },
  "projects": {
    "myproject": {
      "name": "My Project",
      "directory": "/path/to/project"
    }
  }
}
```

3. 启动服务器：

```bash
bun run src/index.ts serve
```

### 方法2：配置 Telegram Bot

1. 创建 Telegram Bot：
   - 联系 [@BotFather](https://t.me/botfather)
   - 发送 `/newbot`
   - 按提示设置 bot 名称和描述
   - 获取 bot token（格式：`123456:ABC-DEF...`）

2. 获取用户 ID（用于白名单）：
   - 联系 [@userinfobot](https://t.me/userinfobot)
   - 发送任意消息
   - 记录返回的 ID

3. 更新配置：

```json
{
  "im": {
    "type": "telegram",
    "token": "123456:ABC-DEF...",
    "allowedUsers": [123456789]
  }
}
```

4. 启动并测试：

```bash
bun run src/index.ts serve
```

## 配置说明

配置文件位置：`.opencode.json`

### 主要配置项

| 配置键            | 类型     | 说明                                         |
| ----------------- | -------- | -------------------------------------------- |
| `im.enabled`      | boolean  | 是否启用 IM 集成（默认：true）               |
| `im.type`         | string   | 平台类型：telegram, slack, whatsapp, discord |
| `im.token`        | string   | Bot token                                    |
| `im.allowedUsers` | number[] | 用户 ID 白名单（Telegram）                   |
| `im.maxFileSize`  | number   | 最大文件大小（字节，默认：20MB）             |
| `im.allowedTypes` | string[] | MIME 类型白名单                              |
| `im.storagePath`  | string   | 本地媒体存储路径                             |
| `im.cleanupDays`  | number   | 媒体保留天数（默认：15）                     |

### 项目配置

```json
{
  "projects": {
    "project-key": {
      "name": "项目名称",
      "directory": "/path/to/project"
    }
  }
}
```

## 使用方法

1. **启动服务器**：

```bash
bun run src/index.ts serve
```

2. **发送消息**：
   - 在 Telegram 中打开你的 bot
   - 发送文本消息或媒体文件
   - AI 将自动响应

## 可用命令

| 命令                     | 说明         |
| ------------------------ | ------------ |
| `/switch_project <name>` | 切换项目     |
| `/list_projects`         | 列出所有项目 |
| `/session_info`          | 显示会话信息 |
| `/help`                  | 显示帮助信息 |

## 开发

### 构建类型：

```bash
bun run typecheck
```

### 运行测试：

```bash
bun test
```

## 常见问题

**Q: Bot 没有响应？**
A: 检查：

1. Bot token 是否正确
2. 用户是否在 allowedUsers 白名单中
3. 服务器是否正常运行

**Q: 媒体文件太大？**
A: 调整 `im.maxFileSize` 配置

**Q: 如何禁用 IM 集成？**
A: 在配置中设置 `"im": {"enabled": false}`

## 许可证

MIT

Follow the interactive prompts to configure your IM platform.

### 2. Edit configuration

The config file is created in your project root:

```
.opencode.json
```

Edit this file and add your bot token (and user ID for Telegram).

### 3. Start server

```bash
opencode serve
```

Then send messages to your bot to start using OpenCode!

## Features

### Media Support

- All media types: photo, document, audio, video, voice, video_note
- File size limit: 20MB
- MIME type whitelist
- Local storage with auto-cleanup (15 days)

### Session Management

- Auto-create session per chat
- Auto-compaction with notifications
- Project switching commands

### User Authentication

- Telegram user ID whitelist
- Configurable allowed users

### Commands

| Command                  | Description       |
| ------------------------ | ----------------- |
| `/switch_project <name>` | Switch to project |
| `/list_projects`         | List all projects |
| `/session_info`          | Show session info |
| `/help`                  | Show help         |

### Configuration

Configuration is saved in project directory (same as OpenCode):

```
.opencode.json
```

Config keys:

- `im.type` - Platform (telegram, slack, whatsapp, discord)
- `im.token` / `im.botToken` - Bot token
- `im.allowedUsers` - User ID whitelist (Telegram)
- `im.maxFileSize` - Max file size (default: 20MB)
- `im.allowedTypes` - MIME type whitelist
- `im.storagePath` - Local media storage path
- `im.cleanupDays` - Media retention in days (default: 15)
- `projects` - Named project paths

## Usage

1. Initialize: `opencode init`
2. Configure: Edit `.opencode.json` with your credentials
3. Start: `opencode serve`
4. Use: Send messages to your bot

## Switching Platforms

To use a different IM platform:

```bash
opencode init --platform slack
opencode init --platform telegram --token NEW_TOKEN
```
