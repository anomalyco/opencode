# opencode-patent-plugin

YunPat 知识产权智能体 Plugin for OpenCode

## 概述

本 Plugin 将 [YunPat](https://github.com/xujian519/yunpat)（知识产权全生命周期智能体平台，49 个包、29 个智能体、18.4 万行代码）封装为 OpenCode Plugin，在 OpenCode 的 TUI/Desktop/Web/VSCode 多平台环境中提供专利智能体能力。

## 能力

- **规则研究** — 法规/案例/实务研究（patent_research）
- **专利撰写** — 5 步骤撰写流程（patent_draft）
- **审查意见答辩** — OA 分析与答复（oa_response）
- **专利检索** — 7500 万 CN 专利 + Google Patents（patent_search）
- **专利分析** — 新颖性/创造性/侵权分析（patent_analyze）
- **质量检查** — 7 维度质量评估（patent_check）

## 安装

### 方式 1：作为 OpenCode Plugin 安装（推荐）

```bash
# 在 .yunpat-agent/yunpat-agent.jsonc 中添加：
{
  "plugin": [
    ["/path/to/opencode-patent-plugin", {
      "model": "deepseek-reasoner",
      "provider": "deepseek",
      "temperature": 0.3
    }]
  ]
}
```

### 方式 2：作为 MCP Server 安装

YunPat 提供独立的 MCP Server，可被任何 MCP 客户端使用：

```jsonc
{
  "mcp": {
    "yunpat-patent": {
      "type": "local",
      "command": ["node", "/path/to/YunPat/packages/mcp-server/dist/index.js"],
      "environment": {
        "DEEPSEEK_API_KEY": "your-api-key"
      }
    }
  }
}
```

## 配置

### Plugin 配置

在 `.yunpat-agent/yunpat-agent.jsonc` 中添加：

```jsonc
{
  "plugin": [
    ["opencode-patent-plugin", {
      "model": "deepseek-reasoner",
      "provider": "deepseek",
      "temperature": 0.3
    }]
  ]
}
```

### YunPat 路径配置

设置环境变量指定 YunPat 项目位置：

```bash
export YUNPAT_PATH=/Users/xujian/projects/YunPat
```

Plugin 会动态加载 YunPat 模块，如果不可用则自动降级为纯 LLM 模式。

## 架构

```
opencode-patent-plugin/
├── src/
│   ├── index.ts              # Plugin 入口
│   ├── adapters/
│   │   └── llm.ts            # OpenCode → YunPat LLM 适配器
│   ├── tools/
│   │   ├── research.ts       # 规则研究工具
│   │   ├── draft.ts          # 专利撰写工具
│   │   ├── oa.ts             # 审查意见答辩工具
│   │   ├── search.ts         # 专利检索工具
│   │   ├── analyze.ts        # 专利分析工具
│   │   └── check.ts          # 质量检查工具
│   ├── utils/
│   │   └── agent-factory.ts  # YunPat Agent 工厂
│   └── types.ts              # 共享类型
└── skills/
    └── patent-workflow.md    # 专利工作流 Skill
```

## 开发

```bash
# 安装依赖
bun install

# 类型检查
bun run typecheck

# 构建
bun run build
```

## 依赖

- OpenCode >= 1.14.0
- YunPat Agent Framework（本地文件引用）

## License

MIT
