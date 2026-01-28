# Vercel AI SDK（ai）在 OpenCode 的布道式解读

这不是“又一个 SDK 说明书”，而是把 AI 能力做成**可复用、可演进的工程底座**。下面我先用官方 API 把地图画清楚，再讲在本项目里它扮演的角色，最后给出真实的工程价值。

---

## 一、先讲 API：官方能力地图

### 1) 文本生成与流式输出

- **`generateText`**：适合非交互式任务（批处理、自动化、总结、报告生成）。
- **`streamText`**：适合交互式场景（聊天、实时 UI 输出），可边生成边输出。

> 你要的是“立刻有回应”，`streamText` 就是为此设计的；你要的是“确定的最终结果”，`generateText` 更合适。

### 2) 结构化输出

- **`generateObject`**：按 schema 输出结构化对象（抽取、分类、配置生成）。
- **`streamObject`**：流式结构化输出（官方更推荐用 `streamText` + `output` 统一流式输出链路）。

> 结构化输出是把“AI 的自由发挥”变成“工程可控的 JSON”，这一步是从 Demo 到系统级能力的关键跃迁。

### 3) 工具调用（Tool Calling）

- **`tool`**：定义可被模型调用的工具，包含 `description`、`inputSchema`、`execute`。
- **`dynamicTool`**：为运行时动态工具设计（例如 MCP 工具、外部插件）。
- **`inputSchema`** 支持 Zod 或 JSON Schema。
- **`jsonSchema`**：把 JSON Schema 包装成 AI SDK 可识别格式。

> 工具调用让模型不只是“说话”，而是真正参与执行任务、调用系统能力。

### 4) Stream Protocols（状态变化）

AI SDK 的 Stream Protocols 定义了流式输出的“状态片段”，其中 **Data Stream Protocol** 是 UI 侧最常用的协议。核心状态包括：

- `start`：响应开始
- `text-start` → `text-delta` → `text-end`：文本输出的开始、增量与结束
- `reasoning-start` → `reasoning-delta` → `reasoning-end`：推理输出（若模型提供）
- `tool-input-start` → `tool-input-delta` → `tool-input-available`：工具输入流式拼装并完成
- `tool-output-available`：工具执行结果可用
- `start-step` → `finish-step`：步骤级切分（用于分段结算/追踪）
- `finish` / `abort` / `error`：正常结束、终止或错误

另外，在 `streamText().fullStream` 的服务器端事件流里，还会出现 `tool-input-end`、`tool-call` 等事件，用于更细粒度地表达工具输入与执行过程。

> 把流式输出拆成“状态片段”，就能让 UI、日志、持久化都拥有统一的事件语义。

### 5) Provider 与 Gateway

- **AI Gateway Provider**：通过一个入口接入多家模型服务。
- 支持 **API Key** 与 **OIDC** 鉴权方式。
- 支持 `createGateway` 自定义实例与配置（API Key、baseURL、headers）。

> 这是工程规模化的关键：统一入口、统一鉴权、统一观测，避免“多供应商拼图式集成”。

### 6) Vercel Provider（v0 模型能力）

- 通过 `@ai-sdk/vercel` 提供 v0 API 访问。
- **v0 模型支持文本 + 图片输入**，并支持**快速流式输出**。
- 可用 `vercel` 默认实例或 `createVercel` 自定义配置（`apiKey`、`baseURL`、`headers`）。

### 7) “模型字符串即调用”的默认行为

- 当你直接写 `model: "provider/model"` 时，默认使用 **Vercel AI Gateway**。
- 若要改默认 Provider，可设置 `globalThis.AI_SDK_DEFAULT_PROVIDER`。

---

## 二、再讲作用：它在 OpenCode 里扮演什么角色

这里不讲空话，只看本仓库的实际落点。

### 1) Provider 统一入口

文件：`packages/opencode/src/provider/provider.ts`

- 统一注册 `@ai-sdk/*` Provider（包括 `@ai-sdk/vercel`）。
- 对不同 Provider 的加载逻辑做统一封装。
- Vercel Provider 额外加上 header，方便平台侧识别来源。

**作用**：把“不同厂商的差异”收敛到一个入口，让上层逻辑无需关心 Provider 细节。

### 2) 消息与参数兼容层

文件：`packages/opencode/src/provider/transform.ts`

- 修复不同模型对 tool-call id、空内容等限制。
- 统一 providerOptions 结构。

**作用**：让上层逻辑保持一致，避免“模型差异导致行为漂移”。

### 3) 统一流式推理管线

文件：`packages/opencode/src/session/llm.ts`

- 核心调用使用 `streamText`。
- 支持工具调用、失败修复、流式输出、请求 headers 等。

**作用**：TUI / CLI / App 全部走同一套推理入口，体验一致。

### 4) Stream Protocols 在项目里的消费方式

文件：`packages/opencode/src/session/processor.ts`

- `streamText(...).fullStream` 输出事件序列逐条消费。
- `start`：将会话标记为 busy。
- `text-start` / `text-delta` / `text-end`：组装为 `MessageV2.TextPart` 并流式写盘。
- `reasoning-start` / `reasoning-delta` / `reasoning-end`：组装为推理分段并持久化。
- `tool-input-start`：建立 `ToolPart` 占位并进入 pending。
- `tool-call` / `tool-result`：触发工具执行并回写结果。
- `start-step` / `finish-step`：生成快照、结算用量与成本。
- `tool-input-delta` / `tool-input-end`：保留事件位，当前不参与业务逻辑。
- `error`：交由外层捕获并走重试逻辑；中断由 `AbortSignal` 触发。
- `finish`：事件本身不额外处理，统一由 `finish-step` 完成收尾。

**作用**：把官方协议中的“状态片段”转成真实会话数据结构与持久化事件。

### 5) 工具与 MCP 打通

文件：`packages/opencode/src/session/prompt.ts`、`packages/opencode/src/mcp/index.ts`

- 本地工具使用 `tool` / `jsonSchema`。
- MCP 工具通过 `dynamicTool` 动态映射。

**作用**：把“模型—工具—执行”闭环真正落地。

### 6) 结构化输出用于 Agent

文件：`packages/opencode/src/agent/agent.ts`

- 使用 `generateObject` / `streamObject` 生成配置或结构化产物。

**作用**：让“代理生成、任务拆解、总结标题”成为可控输出而非随机文本。

---

## 三、最后讲价值：为什么这套东西值得用

### 1) 把多模型时代的复杂度压成“一条线”

**价值**：业务只关心“能力”，而不是“某一家 SDK 的细节”。

### 2) 一次接入，多模型共享

**价值**：交付速度更快，换模型与扩模型成本更低。

### 3) 从“聊天”到“执行”的跃迁

**价值**：AI 不再是“生成文本”，而是“驱动工作流”。

### 4) 结构化输出 = 可控工程化

**价值**：可验证、可回放、可审计，系统稳定性显著提升。

### 5) 面向前端与现代 Web 的优势

**价值**：UI 生成、前端迭代、交互实验会更顺滑。

---

## 四、在本项目中如何落地（最短路径）

1. `opencode auth login` 选择 `vercel` 并写入 API key。
2. 选择 Vercel 相关模型（provider 数据驱动）。
3. 发起对话请求，走 `LLM.stream` → `streamText` 统一管线。
4. 使用本地工具或 MCP 工具进入工具调用链路。

---

## 五、关键文件速查

- Provider 注册：`packages/opencode/src/provider/provider.ts`
- Provider 兼容处理：`packages/opencode/src/provider/transform.ts`
- 流式推理入口：`packages/opencode/src/session/llm.ts`
- 流式事件处理：`packages/opencode/src/session/processor.ts`
- 工具与 MCP：`packages/opencode/src/session/prompt.ts`、`packages/opencode/src/mcp/index.ts`
- 结构化输出：`packages/opencode/src/agent/agent.ts`

---

## 六、参考范围（官方文档）

- Vercel AI SDK Core 文档（生成、流式、结构化输出、工具调用）
- Vercel AI SDK Providers 文档（Vercel Provider / AI Gateway Provider）
- Vercel AI SDK Stream Protocols 文档（Data Stream Protocol）
- Vercel AI Gateway 官方说明
