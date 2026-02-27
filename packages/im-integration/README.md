# OpenCode IM 集成使用指南

## 安装和配置

### 1. 创建 Telegram Bot

1. 在 Telegram 中找 @BotFather
2. 发送 `/newbot` 创建 bot
3. 获取 bot token
4. 获取你的 User ID（找 @userinfobot 或 @myidbot）

### 2. 配置 OpenCode

编辑 `~/.config/opencode/opencode.json`：

```json
{
  "im": {
    "type": "telegram",
    "token": "YOUR_BOT_TOKEN",
    "maxFileSize": 20971520,
    "allowedTypes": ["image/*", "application/pdf", "text/*"],
    "storagePath": "~/.opencode/im-media",
    "cleanupDays": 15,
    "allowedUsers": [YOUR_USER_ID]
  },
  "projects": {
    "api": {
      "directory": "~/projects/api",
      "name": "Backend API"
    }
  },
  "compaction": {
    "auto": true,
    "notify": true
  }
}
```

### 3. 启动服务

```bash
opencode serve
```

## 配置说明

### IM 配置

| 字段           | 说明                 | 默认值               |
| -------------- | -------------------- | -------------------- |
| `type`         | IM 类型              | "telegram"           |
| `token`        | Bot Token            | 必填                 |
| `maxFileSize`  | 最大文件大小（字节） | 20MB                 |
| `allowedTypes` | MIME 类型白名单      | 无限制               |
| `storagePath`  | 媒体本地存储路径     | ~/.opencode/im-media |
| `cleanupDays`  | 媒体保留天数         | 15                   |
| `allowedUsers` | 允许的用户 ID        | 无（开放所有）       |

### 项目配置

| 字段        | 说明         |
| ----------- | ------------ |
| `directory` | 项目目录路径 |
| `name`      | 项目显示名称 |

## 命令列表

| 命令              | 说明             |
| ----------------- | ---------------- |
| `/switch_project` | 切换到指定项目   |
| `/list_projects`  | 列出所有项目     |
| `/session_info`   | 显示当前会话信息 |
| `/help`           | 显示帮助         |

## 会话管理

- 每个 Telegram 聊天自动创建独立会话
- 切换项目会创建新会话（旧会话保留）
- 会话自动压缩（基于 token 限制）
- 压缩时发送通知

## 媒体功能

### 支持的媒体类型

- 📷 照片
- 📄 文档
- 🎵 音频
- 🎬 视频
- 🎤 语音
- 🎥 视频笔记

### 功能特性

- 文件大小检查（20MB 限制）
- 文件类型白名单
- 下载到本地中转
- 发送本地/远程文件到 Telegram

## 用户认证

- 支持 Telegram 用户 ID 白名单
- 未授权用户收到提示
- 配置为空时开放所有用户

## 故障排查

### Bot 无响应

```bash
# 检查 IM 配置是否加载
cat ~/.config/opencode/opencode.json

# 检查 Bot Token 是否正确
# 检查 User ID 是否在白名单中
```

### 媒体文件未保存

```bash
# 检查存储路径权限
ls -la ~/.opencode/im-media

# 磀查磁盘空间
df -h
```

### 会话未创建

```bash
# 检查 OpenCode 日志
tail -f ~/.local/share/opencode/logs/opencode.log

# 重启服务
# 手动重启
opencode serve
```

## 扩展性

目前预留了以下 IM 接口：

- ✅ Telegram（已实现）
- 🔄 Slack（预留）
- 🔄 WhatsApp（预留）
- 🔄 Discord（预留）

添加新 IM 时，实现对应 Adapter 接口并在 Config.Info 中添加配置即可。

## 示例工作流

### 1. 基本对话

```
用户: 帮我写一个函数
Bot: OpenCode 分析代码并生成函数
```

### 2. 发送文件

```
用户: [发送图片 screenshot.png]
Bot: 📷 用户发送了: screenshot.png (0.5 MB)
Bot: OpenCode 分析图片
Bot: [返回结果]
```

### 3. 项目切换

```
用户: /switch_project
Bot: 📁 可用项目：
• api - Backend API
  ~/projects/api
• frontend - Frontend App
  ~/projects/frontend

用户: /switch_project frontend
Bot: ✅ 已切换到项目: Frontend App

📂 路径: ~/projects/frontend
💬 新会话已创建
```

### 4. 会话压缩

```
Bot: 🗜️ 会话已压缩

💬 消息数: 123
📎 媒体数: 5
📦 压缩时间: 2026-02-27 15:30:00
🔄 新会话已创建，可以继续对话
```

## 安全建议

1. 始终使用 HTTPS Bot API
2. 不要在公开仓库中暴露 Bot Token
3. 定期更新 OpenCode 版本
4. 监控日志文件
5. 限制 allowedUsers 只给信任用户
