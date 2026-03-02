# 安装和测试指南

## 📋 前提条件

- Node.js 18+ 或 Bun
- 一个 Telegram Bot Token（从 @BotFather 获取）

## 🚀 快速开始

### 1. 获取 Telegram Bot Token

1. 在 Telegram 中找到 [@BotFather](https://t.me/botfather)
2. 发送 `/newbot`
3. 按提示设置 bot 名称
4. 复制返回的 token（格式：`123456:ABC-DEF...`）

### 2. 获取你的 Telegram User ID

1. 在 Telegram 中找到 [@userinfobot](https://t.me/userinfobot)
2. 发送任意消息
3. 记录返回的 "Id" 数字

### 3. 创建配置文件

在你的项目目录创建 `.opencode/opencode.json`：

```json
{
  "im": {
    "type": "telegram",
    "token": "YOUR_BOT_TOKEN",
    "allowedUsers": [YOUR_USER_ID],
    "enabled": true
  },
  "projects": {
    "default": {
      "name": "默认项目",
      "directory": "/Users/yourname/Desktop/myproject"
    }
  }
}
```

### 4. 启动 OpenCode 服务器

```bash
cd /path/to/opencode/packages/opencode
bun run src/index.ts serve
```

### 5. 测试

1. 在 Telegram 中打开你的 bot
2. 发送消息："hello"
3. 应该收到 AI 的回复

## 📦 发布给其他人使用

当前 IM 集成是 OpenCode 的一部分。要分享给其他人：

### 选项 1：分享配置模板

创建一个示例配置文件分享给用户：

```json
{
  "im": {
    "type": "telegram",
    "token": "用户需要填写自己的 bot token",
    "allowedUsers": [用户需要填写自己的 user ID]
  },
  "projects": {
    "example-project": {
      "name": "示例项目",
      "directory": "/path/to/project"
    }
  }
}
```

### 选项 2：作为独立功能发布

如果需要将 IM 集成作为独立包发布：

1. 确保所有依赖都标记为 peerDependencies
2. 构建 TypeScript：`bun run build`
3. 发布到 npm：`npm publish`

### 选项 3：集成到主包（推荐）

保持当前设计，IM 集成作为 OpenCode 的内置功能：

- 用户安装 OpenCode
- 通过配置文件启用 IM 集成
- 无需额外安装

## 🔧 本地开发

### 运行开发服务器

```bash
cd /path/to/opencode/packages/opencode
bun run dev
```

### 查看日志

```bash
tail -f ~/.local/share/opencode/log/dev.log
```

### 调试 IM 集成

1. 设置环境变量启用详细日志：

```bash
export OPENCODE_LOG_LEVEL=DEBUG
bun run src/index.ts serve
```

2. 检查配置是否正确加载

3. 验证 bot token 和 user ID

## 🐛 故障排除

### Bot 无响应

1. 检查 Bot Token 是否正确
2. 确认用户 ID 在白名单中
3. 查看服务器日志：`tail -f ~/.local/share/opencode/log/dev.log`
4. 检查网络连接

### 媒体上传失败

1. 检查文件大小是否超过 20MB
2. 确认 MIME 类型在允许列表中
3. 检查存储路径权限

### 连接超时

1. 确认服务器在运行：`lsof -i :4096`
2. 检查防火墙设置
3. 尝试重启服务器

## 📚 更多资源

- [OpenCode 主文档](https://docs.opencode.ai)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [问题反馈](https://github.com/opencode-ai/opencode/issues)

## ✅ 测试清单

在发布或分享给用户前，确保测试：

- [ ] 文本消息正常工作
- [ ] 图片上传和分析正常
- [ ] 文档上传正常
- [ ] 项目切换正常
- [ ] 会话创建和管理正常
- [ ] 权限控制正常（白名单）
- [ ] 错误处理正常
- [ ] 日志输出清晰有用
