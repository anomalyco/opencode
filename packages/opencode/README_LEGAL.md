# 法律智能助手 (基于 OpenCode)

面向法律从业者的专业 AI 智能助手。

## 特性

- **案件审查**: 协助检察官进行案件分析和证据审查
- **法律检索**: 检索法律法规、司法解释、指导性案例
- **文书生成**: 起草起诉书、审查报告等法律文书
- **法律咨询**: 提供专业法律意见和类案参考

## 快速开始

### 1. 配置模型

复制示例配置文件:

```bash
cp legal-opencode.json opencode.json
```

编辑配置文件，设置你的模型 API:

```jsonc
{
  "model": "deepseek/deepseek-chat",
  "providers": {
    "deepseek": {
      "type": "openai",
      "baseURL": "https://api.deepseek.com",
      "apiKey": "YOUR_API_KEY"
    }
  },
  "experimental": {
    "legal_mode": true
  }
}
```

### 2. 配置 MCP 服务（可选）

编辑 `opencode.json`，配置法规库和案例库 MCP 服务:

```jsonc
{
  "mcp": {
    "law-regulation": {
      "type": "remote",
      "url": "https://your-law-server.com/mcp",
      "enabled": true
    }
  }
}
```

### 3. 启动

```bash
bun run start
```

## 可用智能体

| 智能体 | 用途 |
|--------|------|
| case_reviewer | 案件审查官（默认） |
| legal_advisor | 法律顾问 |
| doc_assistant | 文书助手 |

切换智能体: 按 `Tab` 键

## 可用工具

| 工具 | 用途 |
|------|------|
| law_read | 读取案卷和文书 |
| law_search | 检索法律法规 |
| law_write | 生成法律文书 |

## 与原版 OpenCode 的区别

- 移除了编码相关工具 (glob, grep, lsp, edit 等)
- 替换为法律专用工具
- 使用法律领域专用提示词
- 默认配置国产大模型

## 推荐模型

| 模型 | 用途 |
|------|------|
| DeepSeek Chat | 日常法律问答、案件分析 |
| DeepSeek Reasoner | 复杂法律推理 |
| 通义千问 Max | 法律检索、法规解读 |
| 智谱 GLM-4 | 法律文书生成 |

## 文件结构

```
packages/opencode/src/
├── session/prompt/
│   ├── legal_base.txt      # 法律基础提示词
│   ├── case_review.txt     # 案件审查提示词
│   └── document_draft.txt  # 文书起草提示词
├── tool/
│   ├── law_read.ts         # 案卷阅读工具
│   ├── law_write.ts        # 文书生成工具
│   └── law_search.ts       # 法律检索工具
└── config/
    ├── legal-agents.ts     # 法律智能体配置
    └── legal-defaults.ts   # 默认配置
```

## 许可证

遵循 OpenCode 原版许可证 (MIT)
