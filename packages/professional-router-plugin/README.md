# Professional Router Plugin

专业业务智能路由插件 for OpenCode

## 概述

本插件为 OpenCode 提供专业业务智能路由能力，自动识别法律、专利、商标、版权等专业业务，并根据任务复杂度选择合适的工作流程。

## 功能

- **智能路由**：自动识别专业业务领域（专利、商标、法律、版权）
- **复杂度评估**：根据任务内容评估复杂度（简单、中等、复杂）
- **工作流选择**：根据复杂度自动选择工作流程
  - 简单任务 → 直接执行（DIRECT）
  - 中等任务 → HITL 模式（2个检查点）
  - 复杂任务 → Plan + HITL 模式（4个检查点）
- **技能推荐**：根据路由决策推荐相应的技能和工具
- **HITL 集成**：集成人机协作机制，确保专业任务的准确性

## 安装

### 作为 OpenCode Plugin 安装

在 `.yunpat-agent/yunpat-agent.jsonc` 中添加：

```jsonc
{
  "plugin": [
    "professional-router-plugin",
    "opencode-patent-plugin"
  ]
}
```

### 配置

在 `~/.config/yunpat-agent/yunpat-agent.jsonc` 中配置专业模式：

```json
{
  "professionalMode": {
    "enabled": true,
    "modePreference": "B",
    "workflowPreference": "A"
  },
  "domainDetection": {
    "keywords": {
      "patent": {
        "keywords": ["专利", "专利法", "审查", "无效"],
        "prefixes": [],
        "scenes": []
      },
      "trademark": {
        "keywords": ["商标", "注册", "侵权"],
        "prefixes": [],
        "scenes": []
      }
    }
  }
}
```

## 架构

```
professional-router-plugin/
├── src/
│   ├── index.ts              # Plugin 入口
│   ├── types.ts              # 类型定义
│   ├── core/
│   │   └── router-service.ts # 路由服务
│   └── hooks/
│       ├── message-handler.ts   # 消息处理钩子
│       ├── tool-before.ts       # 工具执行前钩子
│       ├── tool-after.ts        # 工具执行后钩子
│       ├── permission.ts        # 权限钩子
│       └── system-prompt.ts     # 系统提示词钩子
└── package.json
```

## 钩子系统

插件通过以下钩子集成到 OpenCode：

1. **"chat.message"** - 拦截用户消息，进行路由决策
2. **"tool.execute.before"** - 工具执行前，根据路由决策决定是否需要确认
3. **"tool.execute.after"** - 工具执行后，记录结果和状态
4. **"permission.ask"** - 权限询问，根据路由决策调整权限策略
5. **"experimental.chat.system.transform"** - 注入专业领域提示词

## 工作流程

```
用户消息
    ↓
chat.message 钩子
    ↓
路由决策（领域 + 复杂度）
    ↓
选择工作流（DIRECT / HITL / PLAN+HITL）
    ↓
tool.execute.before 钩子
    ↓
执行工具（patent_search, xiaona 等）
    ↓
tool.execute.after 钩子
    ↓
更新状态和记录
```

## 与其他插件的集成

### opencode-patent-plugin

本插件与 `opencode-patent-plugin` 协同工作：

1. 本插件负责路由决策和工作流管理
2. patent-plugin 提供具体的专利工具和技能
3. 根据路由决策，自动推荐使用 patent-plugin 中的相应工具

### 技能触发

路由决策可以影响技能触发：

- **专利领域** → 推荐 `xiaona` 技能
- **商标领域** → 推荐 `trademark` 技能
- **法律领域** → 推荐 `legal-knowledge-qa` 技能

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
- @opencode-ai/plugin (workspace)
- @opencode-ai/sdk (workspace)
- effect
- zod

## License

MIT
