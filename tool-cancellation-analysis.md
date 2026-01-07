# OpenCode 工具与 Agent 取消处理机制完整分析

## 目录
1. [核心架构概述](#核心架构概述)
2. [取消信号传递链路](#取消信号传递链路)
3. [各工具的取消处理详解](#各工具的取消处理详解)
4. [权限检查阶段的取消](#权限检查阶段的取消)
5. [返回给模型的提示信息](#返回给模型的提示信息)
6. [关键代码位置索引](#关键代码位置索引)

---

## 核心架构概述

OpenCode 采用 **基于 `AbortSignal` 的标准化取消机制**，从 HTTP API 层级逐层传递到每个工具和 Agent，形成完整的中断控制链。

### 设计原则
1. **中央管理**: 所有 session 的 `AbortController` 在 `SessionPrompt.state` 中统一管理
2. **信号传播**: 通过参数链式传递 `abort: AbortSignal`
3. **即时响应**:
   - 事件驱动: `addEventListener("abort")`
   - 主动检查: `throwIfAborted()`, `aborted` 属性
   - 信号合并: `AbortSignal.any([...signals])`
4. **资源清理**: 使用 `using defer()` 保证清理逻辑执行
5. **状态同步**: 取消时立即更新 `SessionStatus` 为 `idle`

---

## 取消信号传递链路

### 1. 入口：HTTP API

**文件**: `packages/opencode/src/server/server.ts:1013-1040`

```typescript
.post(
  "/session/:sessionID/abort",
  describeRoute({
    summary: "Abort session",
    description: "Abort an active session and stop any ongoing AI processing or command execution.",
  }),
  async (c) => {
    SessionPrompt.cancel(c.req.valid("param").sessionID)
    return c.json(true)
  },
)
```

**说明**: 暴露 REST API 端点，接收取消请求。

---

### 2. ACP Protocol 层

**文件**: `packages/opencode/src/acp/agent.ts:923-932`

```typescript
async cancel(params: CancelNotification) {
  const session = this.sessionManager.get(params.sessionId)
  await this.config.sdk.session.abort(
    {
      sessionID: params.sessionId,
      directory: session.cwd,
    },
    { throwOnError: true },
  )
}
```

**说明**: ACP (Agent Communication Protocol) 层接收通知，调用 SDK 的 abort 方法。

---

### 3. 核心取消逻辑

**文件**: `packages/opencode/src/session/prompt.ts`

#### 3.1 状态管理 (55-77 行)

```typescript
const state = Instance.state(
  () => {
    const data: Record<
      string,
      {
        abort: AbortController        // ← 每个 session 的中止控制器
        callbacks: {
          resolve(input: MessageV2.WithParts): void
          reject(): void
        }[]
      }
    > = {}
    return data
  },
  async (current) => {
    // 清理时自动中止所有 session
    for (const item of Object.values(current)) {
      item.abort.abort()
      for (const callback of item.callbacks) {
        callback.reject()
      }
    }
  },
)
```

#### 3.2 创建 AbortController (232-241 行)

```typescript
function start(sessionID: string) {
  const s = state()
  if (s[sessionID]) return
  const controller = new AbortController()
  s[sessionID] = {
    abort: controller,
    callbacks: [],
  }
  return controller.signal  // ← 返回 signal 用于传递
}
```

#### 3.3 取消逻辑 (243-255 行) ⭐ **核心**

```typescript
export function cancel(sessionID: string) {
  log.info("cancel", { sessionID })
  const s = state()
  const match = s[sessionID]
  if (!match) return

  match.abort.abort()        // ← 1. 触发 abort 事件

  for (const item of match.callbacks) {
    item.reject()            // ← 2. 拒绝所有待处理的 Promise
  }

  delete s[sessionID]        // ← 3. 清理状态
  SessionStatus.set(sessionID, { type: "idle" })  // ← 4. 设置为空闲
  return
}
```

**关键步骤**:
1. 调用 `abort()` 触发所有监听器
2. 拒绝所有等待的回调
3. 删除 session 状态
4. 设置状态为 `idle`

#### 3.4 主循环检查 (257-273 行)

```typescript
export const loop = fn(Identifier.schema("session"), async (sessionID) => {
  const abort = start(sessionID)
  if (!abort) {
    return new Promise<MessageV2.WithParts>((resolve, reject) => {
      const callbacks = state()[sessionID].callbacks
      callbacks.push({ resolve, reject })
    })
  }

  using _ = defer(() => cancel(sessionID))  // ← 退出时自动取消

  while (true) {
    if (abort.aborted) break  // ← 每次循环检查是否已中止

    // ... 主处理逻辑 ...
  }
})
```

---

### 4. 信号传递到工具

**文件**: `packages/opencode/src/session/prompt.ts:644-676`

#### 4.1 创建 Tool.Context (关键代码)

```typescript
const context = (args: any, options: ToolCallOptions): Tool.Context => ({
  sessionID: input.session.id,
  abort: options.abortSignal!,  // ← 从 AI SDK 获取的 abort 信号
  messageID: input.processor.message.id,
  callID: options.toolCallId,
  extra: { model: input.model },
  agent: input.agent.name,

  metadata: async (val: { title?: string; metadata?: any }) => {
    // 元数据更新逻辑
  },

  async ask(req) {  // ← 权限检查函数
    await PermissionNext.ask({
      ...req,
      sessionID: input.session.id,
      tool: { messageID: input.processor.message.id, callID: options.toolCallId },
      ruleset: PermissionNext.merge(input.agent.permission, input.session.permission ?? []),
    })
  },
})
```

**关键**: `abort: options.abortSignal!` - 这是从 Vercel AI SDK 的 `ToolCallOptions` 传递过来的信号。

#### 4.2 工具执行封装 (684-697 行)

```typescript
async execute(args, options) {
  const ctx = context(args, options)  // ← 创建带有 abort 信号的上下文

  await Plugin.trigger("tool.execute.before", {...}, { args })

  const result = await item.execute(args, ctx)  // ← 调用工具，传递 ctx

  await Plugin.trigger("tool.execute.after", {...}, result)

  return result
}
```

---

### 5. LLM 流的 Abort 集成

**文件**: `packages/opencode/src/session/llm.ts:28-39, 162`

```typescript
export type StreamInput = {
  user: MessageV2.User
  sessionID: string
  model: Provider.Model
  agent: Agent.Info
  system: string[]
  abort: AbortSignal  // ← 输入参数包含 abort 信号
  messages: ModelMessage[]
  small?: boolean
  tools: Record<string, Tool>
  retries?: number
}

// 传递给 streamText (162 行)
return streamText({
  // ...其他配置...
  abortSignal: input.abort,  // ← 直接传递给 AI SDK
  // ...
})
```

---

### 6. Processor 中的 Abort 处理

**文件**: `packages/opencode/src/session/processor.ts`

#### 6.1 Processor 接收 Abort (25-30 行)

```typescript
export function create(input: {
  assistantMessage: MessageV2.Assistant
  sessionID: string
  model: Provider.Model
  abort: AbortSignal  // ← 接收 abort 信号
}) {
```

#### 6.2 流处理中检查 (44-55 行)

```typescript
async process(streamInput: LLM.StreamInput) {
  while (true) {
    try {
      const stream = await LLM.stream(streamInput)

      for await (const value of stream.fullStream) {
        input.abort.throwIfAborted()  // ← 若已中止则抛出 DOMException

        // 处理流事件 (tool-call, tool-result, etc.)
      }
    } catch (e: any) {
      // 错误处理
    }
  }
}
```

#### 6.3 中止时清理未完成工具 (375-389 行) ⭐

```typescript
const p = await MessageV2.parts(input.assistantMessage.id)
for (const part of p) {
  if (
    part.type === "tool" &&
    part.state.status !== "completed" &&
    part.state.status !== "error"
  ) {
    await Session.updatePart({
      ...part,
      state: {
        ...part.state,
        status: "error",
        error: "Tool execution aborted",  // ← 返回给模型的错误消息
        time: {
          start: Date.now(),
          end: Date.now(),
        },
      },
    })
  }
}
```

**说明**: 当 session 中止时，所有未完成的工具调用都被标记为 "error" 状态。

---

## 各工具的取消处理详解

### 1. Bash Tool - 进程杀死

**文件**: `packages/opencode/src/tool/bash.ts:190-248`

```typescript
let timedOut = false
let aborted = false
let exited = false

const kill = () => Shell.killTree(proc, { exited: () => exited })

// 1️⃣ 检查是否已经被中止
if (ctx.abort.aborted) {
  aborted = true
  await kill()
}

// 2️⃣ 监听中止事件 (once: true 表示只触发一次)
const abortHandler = () => {
  aborted = true
  void kill()
}
ctx.abort.addEventListener("abort", abortHandler, { once: true })

// 3️⃣ 进程执行
const proc = Bun.spawn([...], {
  stdout: "pipe",
  stderr: "pipe",
})

// 4️⃣ 清理监听器
const cleanup = () => {
  ctx.abort.removeEventListener("abort", abortHandler)
  clearTimeout(timeoutId)
}

proc.once("exit", () => {
  exited = true
  cleanup()
  resolve()
})

// 5️⃣ 返回给模型的提示
const resultMetadata = ["<bash_metadata>"]
if (aborted) {
  resultMetadata.push("User aborted the command")  // ← 告知模型命令被用户中止
}
if (timedOut) {
  resultMetadata.push(`Command timed out after ${timeout}ms`)
}
if (resultMetadata.length > 1) {
  resultMetadata.push("</bash_metadata>")
  output += "\n\n" + resultMetadata.join("\n")
}
```

**处理步骤**:
1. 进入工具前检查 `ctx.abort.aborted`
2. 添加 "abort" 事件监听器（一次性）
3. 触发时调用 `Shell.killTree()` 杀死进程树
4. 清理监听器
5. 在输出元数据中标记 `"User aborted the command"`

**进程树杀死**: `Shell.killTree()` 会递归杀死所有子进程。

---

### 2. Task Tool - 级联取消

**文件**: `packages/opencode/src/tool/task.ts:120-124`

```typescript
function cancel() {
  SessionPrompt.cancel(session.id)  // ← 级联取消子 session
}

ctx.abort.addEventListener("abort", cancel)

using _ = defer(() => ctx.abort.removeEventListener("abort", cancel))

// 执行子代理提示
const result = await SessionPrompt.prompt({
  messageID,
  sessionID: session.id,  // ← 子 session ID
  model: { ... },
  // ...
})
```

**特点**:
- **级联取消**: 当父任务取消时，自动取消子 Agent 的 session
- 使用 `using defer()` 确保清理监听器
- 子 session 的取消会触发其自己的清理逻辑

---

### 3. WebFetch Tool - 合并信号

**文件**: `packages/opencode/src/tool/webfetch.ts:39-69`

```typescript
const controller = new AbortController()
const timeoutId = setTimeout(() => controller.abort(), timeout)

try {
  const response = await fetch(params.url, {
    signal: AbortSignal.any([
      controller.signal,  // ← 超时信号
      ctx.abort           // ← 工具取消信号
    ]),
    headers: { ... },
  })

  clearTimeout(timeoutId)

  // ... 处理响应 ...
} catch (error) {
  clearTimeout(timeoutId)
  throw error
}
```

**关键**:
- 使用 `AbortSignal.any()` 合并多个信号
- 任一信号触发都会中止 fetch 请求
- 超时和用户取消都能正确处理

---

### 4. CodeSearch Tool - 网络请求中止

**文件**: `packages/opencode/src/tool/codesearch.ts:76-130`

```typescript
const controller = new AbortController()
const timeoutId = setTimeout(() => controller.abort(), 30000)

try {
  const response = await fetch(`${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.CONTEXT}`, {
    method: "POST",
    headers,
    body: JSON.stringify(codeRequest),
    signal: AbortSignal.any([controller.signal, ctx.abort]),  // ← 合并信号
  })

  clearTimeout(timeoutId)

  // ... 处理响应 ...
} catch (error) {
  clearTimeout(timeoutId)

  if (error instanceof Error && error.name === "AbortError") {
    throw new Error("Code search request timed out")
  }
  throw error
}
```

**特点**: 同 WebFetch，区分超时和用户中止错误。

---

### 5. WebSearch Tool

**文件**: `packages/opencode/src/tool/websearch.ts:89-102`

```typescript
const controller = new AbortController()
const timeoutId = setTimeout(() => controller.abort(), 25000)

const response = await fetch(`${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.SEARCH}`, {
  method: "POST",
  headers,
  body: JSON.stringify(searchRequest),
  signal: AbortSignal.any([controller.signal, ctx.abort]),
})

clearTimeout(timeoutId)
```

**超时时间**: 25 秒（比 CodeSearch 的 30 秒短）。

---

### 6. Read Tool - 快速同步操作

**文件**: `packages/opencode/src/tool/read.ts`

**特点**:
- Read 是同步文件读取操作，执行速度快
- **无需显式 abort 处理**，因为操作完成很快
- 主要在 **权限检查阶段** (`ctx.ask`) 支持取消
- 如果在权限请求期间取消，会通过 `PermissionNext.ask` 的 Promise 拒绝来中止

---

### 7. Edit Tool - 文件操作与权限

**文件**: `packages/opencode/src/tool/edit.ts:33-110`

```typescript
async execute(params, ctx) {
  // 1️⃣ 参数验证
  if (!params.filePath) {
    throw new Error("filePath is required")
  }

  // 2️⃣ 外部目录权限检查 (可被 abort 中断)
  if (!Filesystem.contains(Instance.directory, filePath)) {
    await ctx.ask({
      permission: "external_directory",
      patterns: [parentDir, path.join(parentDir, "*")],
      // ...
    })
  }

  let diff = ""
  let contentOld = ""
  let contentNew = ""

  // 3️⃣ 文件锁保护
  await FileTime.withLock(filePath, async () => {
    // 读取文件
    const file = Bun.file(filePath)
    await FileTime.assert(ctx.sessionID, filePath)
    contentOld = await file.text()

    // 执行替换
    contentNew = replace(contentOld, params.oldString, params.newString, params.replaceAll)

    diff = trimDiff(createTwoFilesPatch(filePath, filePath, contentOld, contentNew))

    // 4️⃣ 编辑权限检查 (可被 abort 中断)
    await ctx.ask({
      permission: "edit",
      patterns: [path.relative(Instance.worktree, filePath)],
      metadata: { filepath: filePath, diff },
      // ...
    })

    // 5️⃣ 写入文件
    await file.write(contentNew)
    await Bus.publish(File.Event.Edited, { file: filePath })

    // 重新读取确认
    contentNew = await file.text()
    FileTime.read(ctx.sessionID, filePath)
  })

  // 6️⃣ LSP 诊断
  await LSP.touchFile(filePath, true)
  const diagnostics = await LSP.diagnostics()

  return { title, metadata: { diff, diagnostics }, output }
}
```

**取消点**:
1. **外部目录权限检查**: `ctx.ask({ permission: "external_directory" })`
2. **编辑权限检查**: `ctx.ask({ permission: "edit" })`
3. **文件锁内**: 如果 abort 信号在锁内触发，会抛出异常中断

**无显式 abort 检查**: Edit 工具依赖：
- `ctx.ask()` 内部的权限 Promise 拒绝
- 文件操作（Bun.file）足够快，无需检查
- 如果需要可在关键点添加 `ctx.abort.throwIfAborted()`

---

### 8. Write Tool - 类似 Edit

**文件**: `packages/opencode/src/tool/write.ts:23-52`

```typescript
async execute(params, ctx) {
  const filepath = path.isAbsolute(params.filePath)
    ? params.filePath
    : path.join(Instance.directory, params.filePath)

  const file = Bun.file(filepath)
  const exists = await file.exists()
  const contentOld = exists ? await file.text() : ""

  if (exists) await FileTime.assert(ctx.sessionID, filepath)

  const diff = trimDiff(createTwoFilesPatch(filepath, filepath, contentOld, params.content))

  // 权限检查 (可被 abort 中断)
  await ctx.ask({
    permission: "edit",
    patterns: [path.relative(Instance.worktree, filepath)],
    metadata: { filepath, diff },
  })

  // 写入文件
  await Bun.write(filepath, params.content)
  await Bus.publish(File.Event.Edited, { file: filepath })
  FileTime.read(ctx.sessionID, filepath)

  // LSP 诊断
  await LSP.touchFile(filepath, true)
  const diagnostics = await LSP.diagnostics()

  return { title, metadata: { diagnostics, filepath, exists }, output }
}
```

**取消点**: 主要在 `ctx.ask()` 权限检查阶段。

---

### 9. Glob Tool - 快速文件搜索

**文件**: `packages/opencode/src/tool/glob.ts:19-65`

```typescript
async execute(params, ctx) {
  // 权限检查
  await ctx.ask({
    permission: "glob",
    patterns: [params.pattern],
    metadata: { pattern: params.pattern, path: params.path },
  })

  let search = params.path ?? Instance.directory
  search = path.isAbsolute(search) ? search : path.resolve(Instance.directory, search)

  const limit = 100
  const files = []
  let truncated = false

  // 使用 ripgrep 快速搜索
  for await (const file of Ripgrep.files({
    cwd: search,
    glob: [params.pattern],
  })) {
    if (files.length >= limit) {
      truncated = true
      break
    }
    // ... 收集文件信息 ...
  }

  files.sort((a, b) => b.mtime - a.mtime)

  return { title, metadata: { count: files.length, truncated }, output }
}
```

**取消点**:
- 权限检查 `ctx.ask()`
- 如果 ripgrep 搜索时间较长，理论上可以添加 abort 检查

---

### 10. Grep Tool - 内容搜索

**文件**: `packages/opencode/src/tool/grep.ts:17-131`

```typescript
async execute(params, ctx) {
  if (!params.pattern) {
    throw new Error("pattern is required")
  }

  // 权限检查
  await ctx.ask({
    permission: "grep",
    patterns: [params.pattern],
    metadata: { pattern: params.pattern, path: params.path, include: params.include },
  })

  const searchPath = params.path || Instance.directory
  const rgPath = await Ripgrep.filepath()
  const args = ["-nH", "--field-match-separator=|", "--regexp", params.pattern]

  if (params.include) {
    args.push("--glob", params.include)
  }
  args.push(searchPath)

  // 执行 ripgrep (同步等待)
  const proc = Bun.spawn([rgPath, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  })

  const output = await new Response(proc.stdout).text()
  const errorOutput = await new Response(proc.stderr).text()
  const exitCode = await proc.exited

  // 处理结果 ...
  return { title, metadata: { matches, truncated }, output }
}
```

**取消点**:
- 权限检查阶段
- `proc.exited` 等待期间（理论上可添加 abort 检查）

---

## 权限检查阶段的取消

### 1. PermissionNext.ask 实现

**文件**: `packages/opencode/src/permission/next.ts:116-146`

```typescript
export const ask = fn(
  Request.partial({ id: true }).extend({
    ruleset: Ruleset,
  }),
  async (input) => {
    const s = await state()
    const { ruleset, ...request } = input

    for (const pattern of request.patterns ?? []) {
      const rule = evaluate(request.permission, pattern, ruleset, s.approved)

      // 1️⃣ 拒绝规则 - 立即抛出异常
      if (rule.action === "deny")
        throw new DeniedError(ruleset.filter((r) => Wildcard.match(request.permission, r.permission)))

      // 2️⃣ 询问规则 - 返回 Promise (可被 abort 中断)
      if (rule.action === "ask") {
        const id = input.id ?? Identifier.ascending("permission")
        return new Promise<void>((resolve, reject) => {  // ← 关键 Promise
          const info: Request = { id, ...request }

          s.pending[id] = {
            info,
            resolve,
            reject,  // ← 取消时会调用 reject
          }

          Bus.publish(Event.Asked, info)  // ← 发布事件通知 UI
        })
      }

      // 3️⃣ 允许规则 - 继续
      if (rule.action === "allow") continue
    }
  },
)
```

**关键**:
- 返回 Promise，挂起等待用户批准
- **取消时**: `SessionPrompt.cancel()` 会拒绝所有回调，导致这个 Promise 被 reject
- 权限被拒绝会抛出 `RejectedError` 或 `DeniedError`

### 2. 权限被拒绝的错误类型

**文件**: `packages/opencode/src/permission/next.ts:242-263`

```typescript
/** 用户拒绝（无消息） - 停止执行 */
export class RejectedError extends Error {
  constructor() {
    super(`The user rejected permission to use this specific tool call.`)
  }
}

/** 用户拒绝（带消息） - 继续执行但带反馈 */
export class CorrectedError extends Error {
  constructor(message: string) {
    super(`The user rejected permission to use this specific tool call with the following feedback: ${message}`)
  }
}

/** 配置规则拒绝 - 停止执行 */
export class DeniedError extends Error {
  constructor(public readonly ruleset: Ruleset) {
    super(
      `The user has specified a rule which prevents you from using this specific tool call. Here are some of the relevant rules ${JSON.stringify(ruleset)}`
    )
  }
}
```

### 3. 取消时的权限清理

**文件**: `packages/opencode/src/permission/next.ts:164-178`

```typescript
if (input.reply === "reject") {
  existing.reject(input.message ? new CorrectedError(input.message) : new RejectedError())

  // 拒绝此 session 的所有其他待处理权限
  const sessionID = existing.info.sessionID
  for (const [id, pending] of Object.entries(s.pending)) {
    if (pending.info.sessionID === sessionID) {
      delete s.pending[id]
      Bus.publish(Event.Replied, {
        sessionID: pending.info.sessionID,
        requestID: pending.info.id,
        reply: "reject",
      })
      pending.reject(new RejectedError())  // ← 级联拒绝
    }
  }
  return
}
```

**级联拒绝**: 当一个权限被拒绝时，同一 session 的所有待处理权限都被拒绝。

---

## 重试机制中的 Abort 处理

**文件**: `packages/opencode/src/session/retry.ts:10-25`

```typescript
export async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abortHandler = () => {
      clearTimeout(timeout)
      reject(new DOMException("Aborted", "AbortError"))  // ← 标准 AbortError
    }

    const timeout = setTimeout(
      () => {
        signal.removeEventListener("abort", abortHandler)
        resolve()
      },
      Math.min(ms, RETRY_MAX_DELAY),
    )

    signal.addEventListener("abort", abortHandler, { once: true })
  })
}
```

**用途**: 在 `processor.ts:351` 中重试延迟期间也能响应中止

```typescript
await SessionRetry.sleep(delay, input.abort).catch(() => {})
```

---

## 返回给模型的提示信息

### 汇总表

| 位置 | 消息内容 | 触发场景 | 代码位置 |
|------|---------|---------|---------|
| **Bash 工具** | `"User aborted the command"` | Bash 命令执行被用户中止 | `bash.ts:243` |
| **Command 执行** | `"User aborted the command"` | Shell 命令执行被中止 | `prompt.ts:1393` |
| **Processor** | `"Tool execution aborted"` | 任何工具执行被中止 | `processor.ts:382` |
| **Session 状态** | `{ type: "idle" }` | Session 被取消 | `prompt.ts:252` |
| **权限拒绝** | `"The user rejected permission to use this specific tool call."` | 用户拒绝工具权限 | `next.ts:245` |
| **配置拒绝** | `"The user has specified a rule which prevents you from using this specific tool call..."` | 配置规则阻止工具 | `next.ts:259` |

### 详细示例

#### 1. Bash Tool 输出

```typescript
// bash.ts:238-248
const resultMetadata = ["<bash_metadata>"]

if (aborted) {
  resultMetadata.push("User aborted the command")
}

if (timedOut) {
  resultMetadata.push(`Command timed out after ${timeout}ms`)
}

if (resultMetadata.length > 1) {
  resultMetadata.push("</bash_metadata>")
  output += "\n\n" + resultMetadata.join("\n")
}
```

**输出示例**:
```
<bash_metadata>
User aborted the command
</bash_metadata>
```

#### 2. Processor 清理未完成工具

```typescript
// processor.ts:375-389
for (const part of p) {
  if (
    part.type === "tool" &&
    part.state.status !== "completed" &&
    part.state.status !== "error"
  ) {
    await Session.updatePart({
      ...part,
      state: {
        ...part.state,
        status: "error",
        error: "Tool execution aborted",  // ← 模型看到的消息
        time: {
          start: Date.now(),
          end: Date.now(),
        },
      },
    })
  }
}
```

#### 3. 权限拒绝错误

**用户主动拒绝**:
```
The user rejected permission to use this specific tool call.
```

**配置规则拒绝**:
```
The user has specified a rule which prevents you from using this specific tool call.
Here are some of the relevant rules [{"permission":"edit","pattern":"*.md","action":"deny"}]
```

---

## 流程图：完整的取消传播路径

```
┌─────────────────────────────────────────────────────────────┐
│                    用户发起取消                              │
│           (HTTP POST /session/{id}/abort)                   │
└────────────────────────┬────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│              SessionPrompt.cancel(sessionID)                │
│                  - abort.abort()                            │
│                  - 拒绝所有回调                              │
│                  - 删除状态                                  │
│                  - 设置为 idle                               │
└────────────────────────┬────────────────────────────────────┘
                         ↓
              ┌──────────┴──────────┐
              ↓                     ↓
┌──────────────────────┐  ┌──────────────────────┐
│   LLM Stream 中止    │  │  所有待处理权限拒绝   │
│  (abortSignal)       │  │ (PermissionNext.ask)  │
└──────────┬───────────┘  └──────────┬───────────┘
           ↓                         ↓
┌──────────────────────┐  ┌──────────────────────┐
│  Processor 检测中止  │  │   ctx.ask() 抛异常   │
│ (throwIfAborted())   │  │  (RejectedError)     │
└──────────┬───────────┘  └──────────┬───────────┘
           ↓                         ↓
┌──────────────────────┐  ┌──────────────────────┐
│ 标记未完成工具为错误  │  │  工具执行被中断      │
│ (Tool execution      │  │                      │
│  aborted)            │  │                      │
└──────────┬───────────┘  └──────────┬───────────┘
           ↓                         ↓
           └──────────┬──────────────┘
                      ↓
        ┌─────────────────────────────┐
        │   并行传播到所有工具：       │
        │                             │
        │  ┌─────────────────────┐   │
        │  │ Bash Tool           │   │
        │  │ - 监听 abort 事件   │   │
        │  │ - 杀死进程树        │   │
        │  │ - 返回元数据        │   │
        │  └─────────────────────┘   │
        │                             │
        │  ┌─────────────────────┐   │
        │  │ Task Tool           │   │
        │  │ - 级联取消子session │   │
        │  └─────────────────────┘   │
        │                             │
        │  ┌─────────────────────┐   │
        │  │ WebFetch/Search     │   │
        │  │ - AbortSignal.any() │   │
        │  │ - 中止网络请求      │   │
        │  └─────────────────────┘   │
        │                             │
        │  ┌─────────────────────┐   │
        │  │ Edit/Write          │   │
        │  │ - 权限检查被拒绝    │   │
        │  └─────────────────────┘   │
        └─────────────────────────────┘
                      ↓
        ┌─────────────────────────────┐
        │      最终结果：              │
        │  - 进程被杀死               │
        │  - 网络请求中止             │
        │  - LLM 流停止               │
        │  - 工具标记为 error         │
        │  - Session 状态为 idle      │
        │  - 模型收到错误消息         │
        └─────────────────────────────┘
```

---

## 关键代码位置索引

### 核心取消逻辑
| 功能 | 文件路径 | 行号 |
|------|---------|------|
| HTTP abort 端点 | `packages/opencode/src/server/server.ts` | 1013-1040 |
| ACP cancel 方法 | `packages/opencode/src/acp/agent.ts` | 923-932 |
| SessionPrompt.cancel | `packages/opencode/src/session/prompt.ts` | 243-255 |
| AbortController 状态管理 | `packages/opencode/src/session/prompt.ts` | 55-77 |
| AbortController 创建 | `packages/opencode/src/session/prompt.ts` | 232-241 |
| 主循环 abort 检查 | `packages/opencode/src/session/prompt.ts` | 257-273 |
| Tool.Context 创建 | `packages/opencode/src/session/prompt.ts` | 644-676 |

### Processor
| 功能 | 文件路径 | 行号 |
|------|---------|------|
| Processor 接收 abort | `packages/opencode/src/session/processor.ts` | 25-30 |
| 流处理 abort 检查 | `packages/opencode/src/session/processor.ts` | 44-55 |
| 清理未完成工具 | `packages/opencode/src/session/processor.ts` | 375-389 |

### LLM
| 功能 | 文件路径 | 行号 |
|------|---------|------|
| LLM StreamInput 定义 | `packages/opencode/src/session/llm.ts` | 28-39 |
| streamText abortSignal | `packages/opencode/src/session/llm.ts` | 162 |

### 工具实现
| 工具 | 文件路径 | 关键行号 |
|------|---------|---------|
| Bash Tool | `packages/opencode/src/tool/bash.ts` | 190-248 |
| Task Tool | `packages/opencode/src/tool/task.ts` | 120-124 |
| WebFetch Tool | `packages/opencode/src/tool/webfetch.ts` | 39-69 |
| CodeSearch Tool | `packages/opencode/src/tool/codesearch.ts` | 76-130 |
| WebSearch Tool | `packages/opencode/src/tool/websearch.ts` | 89-102 |
| Edit Tool | `packages/opencode/src/tool/edit.ts` | 33-110 |
| Write Tool | `packages/opencode/src/tool/write.ts` | 23-52 |
| Glob Tool | `packages/opencode/src/tool/glob.ts` | 19-65 |
| Grep Tool | `packages/opencode/src/tool/grep.ts` | 17-131 |

### 权限系统
| 功能 | 文件路径 | 行号 |
|------|---------|------|
| PermissionNext.ask | `packages/opencode/src/permission/next.ts` | 116-146 |
| 权限拒绝错误类 | `packages/opencode/src/permission/next.ts` | 242-263 |
| 权限级联拒绝 | `packages/opencode/src/permission/next.ts` | 164-178 |

### 辅助功能
| 功能 | 文件路径 | 行号 |
|------|---------|------|
| 可中止的 sleep | `packages/opencode/src/session/retry.ts` | 10-25 |
| Tool 定义 | `packages/opencode/src/tool/tool.ts` | 15-24, 46-72 |

---

## 总结

### 统一机制的优点

1. **标准化**: 使用 Web 标准的 `AbortSignal` API
2. **可组合**: `AbortSignal.any()` 允许合并多个取消源
3. **即时性**: 事件驱动 + 主动检查，响应迅速
4. **清晰性**: 明确的错误消息传递给模型
5. **可靠性**: `using defer()` 保证资源清理
6. **级联性**: 父任务取消自动取消子任务

### 设计模式

1. **中央管理模式**: `SessionPrompt.state` 统一管理所有 AbortController
2. **观察者模式**: `addEventListener("abort")` 监听取消事件
3. **Promise 模式**: 权限检查通过 Promise reject 传播取消
4. **级联模式**: Task Tool 自动取消子 session
5. **信号合并模式**: `AbortSignal.any()` 处理多源取消

### 最佳实践示例

**长时间运行的工具**（如 Bash）:
```typescript
// 1. 进入时检查
if (ctx.abort.aborted) {
  // 立即清理并退出
}

// 2. 添加监听器
const abortHandler = () => {
  // 执行清理
}
ctx.abort.addEventListener("abort", abortHandler, { once: true })

// 3. 确保清理
using _ = defer(() => {
  ctx.abort.removeEventListener("abort", abortHandler)
})
```

**网络请求工具**（如 WebFetch）:
```typescript
const controller = new AbortController()
const timeoutId = setTimeout(() => controller.abort(), timeout)

await fetch(url, {
  signal: AbortSignal.any([controller.signal, ctx.abort])
})

clearTimeout(timeoutId)
```

**快速同步工具**（如 Read/Edit）:
```typescript
// 依赖 ctx.ask() 的 Promise 拒绝机制
await ctx.ask({
  permission: "edit",
  patterns: [...],
})

// 文件操作足够快，无需显式检查
await Bun.write(filepath, content)
```

---

## 附录：调试建议

### 1. 跟踪取消流程

在以下位置添加日志：
1. `SessionPrompt.cancel()` - 取消入口
2. `abort.addEventListener("abort")` - 各工具的监听器
3. `ctx.abort.throwIfAborted()` - Processor 检查点
4. `PermissionNext.ask()` - 权限 Promise 拒绝

### 2. 常见问题排查

**问题**: 工具未能正确取消
- 检查是否添加了 abort 监听器
- 验证 `ctx.abort` 是否正确传递
- 确认清理逻辑是否执行

**问题**: 资源泄漏
- 确保使用 `using defer()` 清理监听器
- 验证进程/网络请求是否正确关闭

**问题**: 模型未收到取消提示
- 检查 `processor.ts:375-389` 的工具状态更新
- 验证错误消息是否正确设置

---

**文档版本**: 1.0
**分析日期**: 2026-01-07
**覆盖范围**: OpenCode 所有核心工具和 Agent 取消机制
