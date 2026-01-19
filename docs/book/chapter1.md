# 第一章：AI编码助手架构概述

**章节总时长**: 8-10小时
**难度等级**: ⭐⭐☆☆☆
**前置知识**: 无（入门级）
**阶段成果**: 完成Monorepo工程骨架搭建，理解架构全景图

---

## 1.1 核心哲学：无绑定、终端优先

### 1.1.1 OpenCode 设计哲学

OpenCode 的核心理念可以概括为 **"无绑定、终端优先"**。

**无绑定（Provider Agnostic）**：

- 不与任何特定AI提供商强绑定
- 支持 OpenAI、Anthropic、Google、Azure、Amazon Bedrock、Groq、Mistral 等 20+ 种 Provider
- 通过 @ai-sdk 生态系统实现多 provider 支持
- 可通过配置文件轻松切换模型
- 本地模型支持，满足隐私和离线需求

**终端优先（Terminal First）**：

- 核心体验在 Terminal 中打造
- 由 neovim 用户和 terminal.shop 创建者打造
- 追求 Terminal 体验的极限
- CLI 是主要交互界面，@opentui 是核心 TUI 框架

### 1.1.2 C/S 架构设计原理

OpenCode 采用 **客户端/服务器架构**，这一设计带来了独特的优势：

```
┌─────────────────────────────────────────────────────────┐
│                      C/S 架构模型                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│   ┌─────────────┐         ┌─────────────┐              │
│   │   CLI/TUI   │         │   Web UI    │              │
│   │  (yargs)    │         │   (Solid)   │              │
│   └──────┬──────┘         └──────┬──────┘              │
│          │                       │                      │
│          └───────────┬───────────┘                      │
│                      │                                  │
│                      ▼                                  │
│          ┌─────────────────────┐                        │
│          │   Bun Server        │                        │
│          │   (yargs + Hono)    │                        │
│          └──────────┬──────────┘                        │
│                     │                                   │
│                     ▼                                   │
│          ┌─────────────────────┐                        │
│          │   Session Manager   │                        │
│          │   + Event Bus       │                        │
│          └──────────┬──────────┘                        │
│                     │                                   │
│                     ▼                                   │
│          ┌─────────────────────┐                        │
│          │   @ai-sdk Providers │                        │
│          │ (OpenAI/Claude...)  │                        │
│          └─────────────────────┘                        │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**架构优势**：

- **远程驱动**：Server 运行在本地，客户端可以是 CLI、Web、甚至移动端
- **资源分离**：AI 推理在 Server 端，客户端只需展示界面
- **持久会话**：Server 维护会话状态，客户端可以随时断开重连
- **多端同步**：不同客户端共享同一个会话状态

### 1.1.3 四大设计原则

**原则1：Provider Agnostic（无绑定）**

```typescript
// packages/opencode/src/provider/provider.ts
// 支持 20+ AI Provider 的统一抽象

const BUNDLED_PROVIDERS: Record<string, (options: any) => SDK> = {
  "@ai-sdk/amazon-bedrock": createAmazonBedrock,
  "@ai-sdk/anthropic": createAnthropic,
  "@ai-sdk/azure": createAzure,
  "@ai-sdk/google": createGoogleGenerativeAI,
  "@ai-sdk/google-vertex": createVertex,
  "@ai-sdk/openai": createOpenAI,
  "@ai-sdk/groq": createGroq,
  "@ai-sdk/mistral": createMistral,
  "@ai-sdk/mistral": createMistral,
  "@ai-sdk/cohere": createCohere,
  "@ai-sdk/deepinfra": createDeepInfra,
  "@ai-sdk/cerebras": createCerebras,
  "@ai-sdk/perplexity": createPerplexity,
  "@ai-sdk/vercel": createVercel,
  "@ai-sdk/togetherai": createTogetherAI,
  "@ai-sdk/gateway": createGateway,
  // ... 更多 providers
}
```

**原则2：Terminal First（终端优先）**

```typescript
// packages/opencode/src/cli/ui.ts
// 使用 @opentui 构建终端 UI

import { Box, Text, render } from "@opentui/core"

function App() {
  return Box({
    width: "100%",
    height: "100%",
    borderStyle: "round",
    title: "OpenCode",
    children: [Text({ content: "Welcome to OpenCode!" })],
  })
}

render(App, process.stdout)
```

**原则3：Everything is Tool（一切皆工具）**

```typescript
// packages/opencode/src/tool/tool.ts
// 所有操作都通过工具执行

export function define<T>(id: string, config: ToolConfig<T>) {
  return {
    id,
    schema: config.parameters,
    execute: config.execute,
    validate: config.validate,
  }
}

// 24+ 核心工具
export const ReadTool = Tool.define("read", {
  parameters: z.object({ path: z.string() }),
  async execute(params) {
    const content = await Bun.file(params.path).text()
    return { content }
  },
})
```

**原则4：Session Persistence（会话持久）**

```typescript
// packages/opencode/src/session/index.ts
// 会话是状态的载体

export const create = fn(z.object({ title: z.string().optional() }).optional(), async (input) => {
  return createNext({
    directory: Instance.directory,
    title: input?.title,
  })
})
```

---

## 1.2 架构全景图：从宏观到微观

### 1.2.1 系统架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│                        用户界面层 (UI Layer)                      │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│   │   CLI    │  │  TUI     │  │   Web    │  │  Desktop │       │
│   │ (yargs)  │  │(opentui) │  │ (Solid)  │  │ (Tauri)  │       │
│   └──────────┘  └──────────┘  └──────────┘  └──────────┘       │
├─────────────────────────────────────────────────────────────────┤
│                        命令层 (Command Layer)                    │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │  yargs CLI │ serve │ run │ agent │ mcp │ session │ ...  │   │
│   └─────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│                        交互层 (Interaction Layer)                │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │  Session Manager │ Event Bus │ Command Handler           │   │
│   └─────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│                        Agent 核心层 (Agent Core)                 │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │  Planner │ Executor │ Reflector │ ReAct Loop            │   │
│   │  build/plan/general/explore agents                       │   │
│   └─────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│                      上下文引擎层 (Context Engine)                │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │  Context Index │ Memory Manager │ Compaction            │   │
│   └─────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│                        工具系统层 (Tool System)                   │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │  Registry │ Executor │ Validator │ 24+ Core Tools       │   │
│   │  file │ code │ system │ web │ session │ advanced         │   │
│   └─────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│                       AI 能力层 (AI Provider)                    │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │  @ai-sdk 生态系统 │ 20+ Providers │ Model Router        │   │
│   │  OpenAI │ Anthropic │ Google │ Azure │ Bedrock │ Groq   │   │
│   └─────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│                        基础设施层 (Infrastructure)                │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │  Config │ Storage │ EventBus │ Auth │ Permission │ LSP  │   │
│   └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2.2 核心模块详解

**CLI 入口（Command Layer）**：

```typescript
// packages/opencode/src/index.ts

import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { RunCommand } from "./cli/cmd/run"
import { AgentCommand } from "./cli/cmd/agent"
import { ServeCommand } from "./cli/cmd/serve"

const cli = yargs(hideBin(process.argv))
  .parserConfiguration({ "populate--": true })
  .scriptName("opencode")
  .wrap(100)
  .help("help", "show help")
  .version("version", "show version number", Installation.VERSION)
  .command(RunCommand)
  .command(AgentCommand)
  .command(ServeCommand)
  .command(TuiSpawnCommand)
  .command(AttachCommand)
  .demandCommand(1)
  .strict()

try {
  await cli.parse()
} catch (e) {
  Log.Default.error("fatal", data)
  process.exitCode = 1
}
```

**Agent 核心层（Agent Core）**：

```typescript
// packages/opencode/src/agent/agent.ts

export namespace Agent {
  // 定义多种 Agent 类型
  export const state = Instance.state(async () => {
    const result: Record<string, Info> = {
      build: {
        name: "build",
        mode: "primary",
        native: true,
        permission: PermissionNext.merge(defaults, user),
      },
      plan: {
        name: "plan",
        mode: "primary",
        native: true,
        permission: PermissionNext.merge(defaults, user),
      },
      general: {
        name: "general",
        description: `General-purpose agent for researching complex questions...`,
        mode: "subagent",
        native: true,
      },
      explore: {
        name: "explore",
        description: `Fast agent specialized for exploring codebases...`,
        mode: "subagent",
        native: true,
      },
      compaction: {
        name: "compaction",
        mode: "primary",
        native: true,
        hidden: true,
      },
      title: {
        name: "title",
        mode: "primary",
        native: true,
        hidden: true,
      },
      summary: {
        name: "summary",
        mode: "primary",
        native: true,
        hidden: true,
      },
    }
    return result
  })

  export async function list() {
    const cfg = await Config.get()
    return pipe(
      await state(),
      values(),
      sortBy([(x) => (cfg.default_agent ? x.name === cfg.default_agent : x.name === "build"), "desc"]),
    )
  }
}
```

**会话管理层（Session Layer）**：

```typescript
// packages/opencode/src/session/index.ts

export namespace Session {
  export const create = fn(
    z
      .object({
        parentID: Identifier.schema("session").optional(),
        title: z.string().optional(),
        permission: Info.shape.permission,
      })
      .optional(),
    async (input) => {
      return createNext({
        parentID: input?.parentID,
        directory: Instance.directory,
        title: input?.title,
        permission: input?.permission,
      })
    },
  )

  export const get = fn(Identifier.schema("session"), async (id) => {
    return Storage.read<Info>(["session", Instance.project.id, id])
  })

  export async function* list() {
    const project = Instance.project
    for (const item of await Storage.list(["session", project.id])) {
      yield Storage.read<Info>(item)
    }
  }
}
```

**工具系统层（Tool Layer）**：

```typescript
// packages/opencode/src/tool/registry.ts

export class ToolRegistry {
  private tools: Map<string, Tool<any, any>> = new Map()
  private categories: Map<string, Tool<any, any>[]> = new Map()

  register<T, R>(tool: Tool<T, R>): void {
    if (!tool.id || !tool.execute) {
      throw new Error("Invalid tool: missing id or execute function")
    }
    this.tools.set(tool.id, tool)

    const category = tool.category || "general"
    if (!this.categories.has(category)) {
      this.categories.set(category, [])
    }
    this.categories.get(category)!.push(tool)
    console.log(`Tool registered: ${tool.id} (${category})`)
  }

  async execute<T, R>(toolId: string, params: T): Promise<R> {
    const executor = this.executors.get(toolId)
    if (!executor) {
      throw new Error(`Tool ${toolId} not found`)
    }
    return await executor.execute(params)
  }
}
```

**工具分类体系**：

```
file/    → read, write, edit, glob, grep, ls
code/    → lsp, codesearch, symbols
system/  → bash, task, todo, pty
web/     → websearch, webfetch, question
session/ → session, fork, summarize
advanced/→ batch, multiedit, patch
```

**AI 能力层（AI Layer）**：

```typescript
// packages/opencode/src/provider/provider.ts

export async function getLanguage(model: Model): Promise<LanguageModelV2> {
  const s = await state()
  const key = `${model.providerID}/${model.id}`
  if (s.models.has(key)) return s.models.get(key)!

  const provider = s.providers[model.providerID]
  const sdk = await getSDK(model)

  try {
    const language = s.modelLoaders[model.providerID]
      ? await s.modelLoaders[model.providerID](sdk, model.api.id, provider.options)
      : sdk.languageModel(model.api.id)
    s.models.set(key, language)
    return language
  } catch (e) {
    if (e instanceof NoSuchModelError)
      throw new ModelNotFoundError({ modelID: model.id, providerID: model.providerID }, { cause: e })
    throw e
  }
}
```

### 1.2.3 数据流架构

**完整请求处理流程**：

```
用户请求 (CLI/yargs) ──▶ Session Manager ──▶ Agent Core (ReAct)
                                                      │
                                                      ▼
用户响应 ◀─── Event Bus ◀─── AI Provider ◀─── Tool System
```

**状态机**：`created → idle → processing → waiting → idle`

---

## 1.3 技术栈选型：每个选择的的理由

### 1.3.1 运行时与包管理器：Bun 1.3.5

选择 Bun 的原因：

| 特性       | Bun       | Node.js  | npm         |
| ---------- | --------- | -------- | ----------- |
| 启动速度   | 快 3-5 倍 | 基准     | 慢 10-20 倍 |
| 执行速度   | 快 2-3 倍 | 基准     | -           |
| 包安装     | 秒级      | -        | 分钟级      |
| TypeScript | 原生支持  | 需要配置 | 需要配置    |
| Web API    | 完整支持  | 完整支持 | -           |

### 1.3.2 CLI 框架：yargs

yargs 是 Node.js 的命令行解析框架：

```typescript
// packages/opencode/src/index.ts

import yargs from "yargs"
import { hideBin } from "yargs/helpers"

const cli = yargs(hideBin(process.argv))
  .parserConfiguration({ "populate--": true })
  .scriptName("opencode")
  .wrap(100)
  .help("help", "show help")
  .version("version", "show version number", Installation.VERSION)
  .demandCommand(1)
  .strict()
```

- **成熟的 CLI 框架**：功能完整，文档丰富
- **参数解析**：支持复杂参数和子命令
- **类型安全**：提供 TypeScript 类型定义
- **生态完善**：广泛使用的标准工具

### 1.3.3 Web 框架：Hono 4.10.7

Hono 的核心优势：

```typescript
// Hono 服务器示例
import { Hono } from "hono"

const app = new Hono()

app.get("/", (c) => c.text("OpenCode Server"))
app.get("/api/session/:id", async (c) => {
  const id = c.req.param("id")
  const session = await sessionManager.get(id)
  return c.json(session)
})

export default app
```

- **极速性能**：在 Cloudflare Workers 上表现优异
- **极小体积**：压缩后仅 14KB
- **多平台**：支持 Bun、Node.js、Deno、Cloudflare Workers
- **TypeScript 原生**：从设计就考虑类型安全

### 1.3.4 前端框架：SolidJS 1.9.10

SolidJS 核心优势：

```typescript
import { createSignal, createEffect, createMemo } from "solid-js"

const [count, setCount] = createSignal(0)
const doubled = createMemo(() => count() * 2)

createEffect(() => {
  console.log(`Count: ${count()}, Double: ${doubled()}`)
})
```

- **真实 DOM 更新**：无虚拟 DOM 开销
- **细粒度响应式**：精确追踪依赖
- **高性能**：比 React 快 5-10 倍

### 1.3.5 终端 UI：@opentui 0.1.72

OpenCode 使用 @opentui 构建 Terminal 用户界面：

```typescript
import { Box, Text, render } from "@opentui/core"

function App() {
  return Box({
    width: "100%",
    height: "100%",
    borderStyle: "round",
    title: "OpenCode",
    children: [Text({ content: "Welcome to OpenCode!" })],
  })
}

render(App, process.stdout)
```

- **跨平台**：在 Windows、macOS、Linux 上表现一致
- **Unicode 支持**：完整的 Unicode 字符集
- **鼠标支持**：可选的鼠标交互
- **SolidJS 集成**：@opentui/solid 提供 Solid 绑定

### 1.3.6 AI SDK：@ai-sdk

OpenCode 使用 @ai-sdk 生态系统：

```json
// 支持的 Provider
"@ai-sdk/openai": "^2.0.71",
"@ai-sdk/anthropic": "^2.0.56",
"@ai-sdk/google": "^2.0.49",
"@ai-sdk/azure": "^2.0.82",
"@ai-sdk/amazon-bedrock": "^3.0.57",
"@ai-sdk/groq": "^2.0.33",
"@ai-sdk/mistral": "^2.0.26",
```

- **统一接口**：所有 provider 使用相同 API
- **自动工具调用**：内置工具调用支持
- **流式响应**：完整的流式 API 支持
- **成本跟踪**：内置 usage tracking

### 1.3.7 验证库：Zod 4.1.8

```typescript
import z from "zod"

export const Info = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    mode: z.enum(["subagent", "primary", "all"]),
  })
  .meta({ ref: "Agent" })

export type Info = z.infer<typeof Info>
```

### 1.3.8 构建系统：Turbo 2.5.6

```json
// turbo.json
{
  "$schema": "https://turborepo.com/schema.json",
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**", "build/**"],
      "cache": true
    },
    "dev": {
      "cache": false,
      "persistent": true
    }
  }
}
```

- **增量构建**：只重新构建改变的部分
- **远程缓存**：团队共享构建缓存
- **任务编排**：声明式管道

### 1.3.9 技术栈全景图

```
┌─────────────────────────────────────────────────────────────────┐
│                        技术栈全景图                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   运行时层                                                    │
│   ┌─────────┬─────────┐                                       │
│   │   Bun   │  Node   │ Bun 1.3.5 + Node.js 22+                │
│   │ 1.3.5   │  22+    │                                       │
│   └─────────┴─────────┘                                       │
│                                                                 │
│   CLI 框架                                                    │
│   ┌─────────┐                                                 │
│   │ yargs   │ 命令行参数解析                                    │
│   └─────────┘                                                 │
│                                                                 │
│   Web 框架                                                    │
│   ┌─────────┐                                                 │
│   │  Hono   │ 4.10.7 - 极速多平台框架                           │
│   └─────────┘                                                 │
│                                                                 │
│   前端框架                                                    │
│   ┌─────────┬─────────┐                                       │
│   │ SolidJS │ Kobalte │ 1.9.10 + 0.13.11                       │
│   │ 1.9.10  │ 0.13.x  │                                       │
│   └─────────┴─────────┘                                       │
│                                                                 │
│   终端 UI                                                    │
│   ┌───────────────────┐                                       │
│   │ @opentui 0.1.72   │ 跨平台终端界面                          │
│   │ core + solid      │                                       │
│   └───────────────────┘                                       │
│                                                                 │
│   AI SDK                                                    │
│   ┌─────────────────────────────────────────────────────┐     │
│   │ @ai-sdk生态系统: openai, anthropic, google, azure... │     │
│   └─────────────────────────────────────────────────────┘     │
│                                                                 │
│   验证与类型                                                  │
│   ┌─────────┬─────────┬─────────┐                            │
│   │  Zod    │ TypeScript │Remeda │                            │
│   │ 4.1.8   │ 5.8.2   │ 2.26.0  │                            │
│   └─────────┴─────────┴─────────┘                            │
│                                                                 │
│   构建系统                                                    │
│   ┌─────────┬─────────┐                                       │
│   │  Turbo  │  Vite   │ 2.5.6 + 7.1.4                         │
│   └─────────┴─────────┘                                       │
│                                                                 │
│   云端部署                                                    │
│   ┌─────────┬─────────┐                                       │
│   │   SST   │ Cloudflare                                      │
│   │  3.17   │ Workers  │                                       │
│   └─────────┴─────────┘                                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 1.4 Monorepo 工程初始化

### 1.4.1 Monorepo 架构设计

选择 Monorepo 的原因：

- **内部工具共享**：@opencode-ai/ui、@opencode-ai/util、@opencode-ai/sdk
- **统一开发体验**：单一构建系统，统一测试覆盖
- **快速迭代**：跨包修改一次提交

### 1.4.2 目录结构设计

```
opencode/
├── package.json                    # 根配置 (catalog 版本管理)
├── bun.lockb                       # Bun 锁定文件
├── turbo.json                      # Turbo 构建配置
├── tsconfig.json                   # 根 TypeScript 配置
├── .eslintrc.json                  # ESLint 配置
├── .prettierrc                     # Prettier 配置
├── bunfig.toml                     # Bun 配置
├── README.md                       # 项目说明
├── CONTRIBUTING.md                 # 贡献指南
├── STYLE_GUIDE.md                  # 代码风格指南
├── .github/                        # GitHub 配置
├── .husky/                         # Git hooks
├── docs/                           # 项目文档
├── infra/                          # 基础设施 (SST)
├── scripts/                        # 构建脚本
├── specs/                          # 设计规格文档
├── patches/                        # 依赖补丁
└── packages/                       # 核心包
    ├── opencode/                   # 主 CLI 应用
    │   ├── src/
    │   │   ├── agent/              # Agent 核心
    │   │   ├── bus/                # 事件总线
    │   │   ├── cli/                # CLI 命令
    │   │   ├── command/            # 命令处理
    │   │   ├── config/             # 配置管理
    │   │   ├── file/               # 文件操作
    │   │   ├── lsp/                # LSP 集成
    │   │   ├── mcp/                # MCP 协议
    │   │   ├── plugin/             # 插件系统
    │   │   ├── permission/         # 权限系统
    │   │   ├── provider/           # AI Provider
    │   │   ├── session/            # 会话管理
    │   │   ├── storage/            # 存储系统
    │   │   ├── tool/               # 工具系统
    │   │   └── util/               # 工具函数
    │   ├── bin/opencode            # CLI 入口
    │   └── package.json
    ├── desktop/                    # 桌面应用 (Tauri)
    ├── web/                        # 静态网站 (Astro)
    ├── console/                    # 云端控制台
    ├── app/                        # Web 应用 (SolidStart)
    ├── ui/                         # UI 组件库 (SolidJS)
    ├── util/                       # 工具库
    ├── sdk/                        # SDK 包
    ├── plugin/                     # VSCode 插件
    ├── extensions/                 # 编辑器扩展
    ├── slack/                      # Slack 集成
    ├── function/                   # Serverless 函数
    ├── enterprise/                 # 企业功能
    └── identity/                   # 身份资源
```

### 1.4.3 核心配置文件

```json
// package.json - 根配置

{
  "$schema": "https://json.schemastore.org/package.json",
  "name": "opencode",
  "description": "AI-powered development tool",
  "private": true,
  "type": "module",
  "packageManager": "bun@1.3.5",
  "scripts": {
    "dev": "bun run --cwd packages/opencode --conditions=browser src/index.ts",
    "typecheck": "bun turbo typecheck",
    "prepare": "husky"
  },
  "workspaces": {
    "packages": ["packages/*", "packages/console/*", "packages/sdk/js", "packages/slack"],
    "catalog": {
      "@types/bun": "1.3.4",
      "typescript": "5.8.2",
      "ai": "5.0.97",
      "hono": "4.10.7",
      "zod": "4.1.8",
      "solid-js": "1.9.10",
      "remeda": "2.26.0"
    }
  },
  "devDependencies": {
    "husky": "^9.1.7",
    "prettier": "^3.6.2",
    "sst": "3.17.23",
    "turbo": "^2.5.6"
  }
}
```

```json
// packages/opencode/package.json

{
  "$schema": "https://json.schemastore.org/package.json",
  "version": "1.1.13",
  "name": "opencode",
  "type": "module",
  "bin": {
    "opencode": "./bin/opencode"
  },
  "dependencies": {
    "@ai-sdk/openai": "^2.0.71",
    "@ai-sdk/anthropic": "^2.0.56",
    "@opentui/core": "0.1.72",
    "@opentui/solid": "0.1.72",
    "ai": "catalog:",
    "hono": "catalog:",
    "solid-js": "catalog:",
    "zod": "catalog:"
  }
}
```

### 1.4.4 依赖管理策略

使用 workspace:\* 协议和 catalog 版本管理：

```json
// 内部包引用
"dependencies": {
  "@opencode-ai/ui": "workspace:*",
  "@opencode-ai/util": "workspace:*",
  "@opencode-ai/sdk": "workspace:*"
}

// catalog 版本管理（根 package.json）
"catalog": {
  "@types/bun": "1.3.4",
  "zod": "4.1.8",
  "typescript": "5.8.2",
  "ai": "5.0.97",
  "hono": "4.10.7",
  "solid-js": "1.9.10",
  "remeda": "2.26.0"
}
```

### 1.4.5 初始化脚本

```bash
#!/bin/bash
# scripts/setup.sh

set -e

echo "🚀 开始初始化 OpenCode Monorepo..."

check_environment() {
  local cmd=$1
  local name=$2

  if ! command -v $cmd &> /dev/null; then
    echo "❌ $name 未安装，请先安装"
    exit 1
  else
    echo "✅ $name 已安装: $( $cmd --version 2>&1 | head -1 )"
  fi
}

check_environment bun "Bun"
check_environment git "Git"
check_environment node "Node.js"

echo "📦 安装依赖..."
bun install

echo "🔗 安装 Git hooks..."
bun prepare

echo "🔨 构建所有包..."
bun build

echo "🔍 类型检查..."
bun typecheck

echo ""
echo "✅ 初始化完成！"
echo ""
echo "📝 常用命令:"
echo "   开发模式:  bun dev"
echo "   构建项目:  bun build"
echo "   类型检查:  bun typecheck"
echo "   代码格式:  bun format"
```

---

## 1.5 本章总结与成果验证

### 1.5.1 核心概念回顾

**设计哲学**：无绑定（Provider Agnostic）、终端优先（Terminal First）、一切皆工具、会话持久。

**架构设计**：C/S 架构、九层架构模型、核心组件职责、数据流向设计。

**技术选型**：

- Bun 1.3.5：运行时与包管理器
- yargs：CLI 框架
- Hono 4.10.7：Web 框架
- SolidJS 1.9.10：前端框架
- @opentui 0.1.72：终端 UI
- @ai-sdk：AI SDK 生态系统
- Zod 4.1.8：验证库
- Turbo 2.5.6：构建系统

**工程实践**：Monorepo 架构、目录结构设计、依赖管理策略、构建配置优化。

### 1.5.2 成果验证清单

✅ 理解 OpenCode 的设计哲学 - 能解释"无绑定、终端优先"理念，能分析 C/S 架构的优势。

✅ 掌握 OpenCode 的九层架构 - 能绘制架构图，能解释每层的职责。

✅ 理解每个技术栈的选型理由 - 能比较不同技术栈，能解释为什么选择 Bun + yargs + Hono + SolidJS + @opentui + @ai-sdk。

✅ 完成 Monorepo 工程初始化 - 能创建目录结构，能配置构建系统，能运行初始化脚本。

✅ 配置完整的构建系统 - 能配置 Turbo 管道，能配置 TypeScript，能配置代码风格。

### 1.5.3 阶段性成果

**工程成果**：完整的 Monorepo 工程骨架、正确配置的构建系统、TypeScript 和 ESLint 配置、包之间的 workspace 依赖关系、基础的开发构建测试命令。

**知识成果**：理解 AI 编码助手的设计哲学、掌握 C/S 架构设计、理解每个技术栈的选型理由、能进行技术选型决策。

**代码成果**：完整的目录结构、配置文件（package.json、turbo.json、tsconfig.json）、初始化脚本、包模板。

### 1.5.4 下章预告

**下一章**：CLI 框架与命令系统

**内容预览**：yargs 命令路由系统、参数解析、CLI 入口实现、命令生命周期管理、Logger 设计模式。

**预期成果**：能运行 `./bin/opencode --help`，理解命令路由机制，实现基础 CLI 框架。

**学习路径**：第一章（觉醒）→ 工程骨架就绪 → 第二章（进化）→ 命令系统完成 → 第三章（进化）→ 基础设施完成 → 第四章（进化）→ Agent 核心完成 → 第五章（智慧）→ 工具系统完成 → 第六章（智慧）→ 生态扩展完成 → 第七章（卓越）→ 企业级功能完成。
