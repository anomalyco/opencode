# Work Queue 处理器使用指南

## 概述

WorkQueueSessionProcessor 是一个事件驱动的工作队列处理器，用于替换现有的 `while(true)` 轮询模式。

## 核心改进

### 1. 事件驱动替代轮询

```typescript
// ❌ 旧模式：轮询
while (true) {
  const msgs = await MessageV2.stream() // 不断检查
  if (msgs.length > 0) {
    await processMessage(msgs[0])
  }
}

// ✅ 新模式：事件驱动
const loop = async () => {
  const event = await this.eventQueue.next() // 等待事件
  if (event) {
    await this.handleEvent(event)
  }
}
```

### 2. 超时机制

```typescript
// 所有操作都带超时
private async withTimeout<T>(
  promise: Promise<T>,
  timeout: number,
  errorMessage: string
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${errorMessage} (${timeout}ms)`)), timeout)
    ),
  ])
}

// 使用
await Promise.race([
  executor.execute(ctx),
  this.createTimeoutPromise(120_000, "LLM execution timeout"),  // 2分钟超时
])
```

### 3. 心跳监控

```typescript
// 定期更新进度，防止任务被误判为卡住
const heartbeatInterval = setInterval(() => {
  ctx.onProgress?.(50, "LLM processing...")
  ctx.board.updateProgress(task.id, task.progress, "heartbeat")
}, 10_000) // 每10秒心跳

// 任务完成或出错时清理
clearInterval(heartbeatInterval)
```

### 4. 并发控制

```typescript
private maxConcurrency = 2  // 最多2个并发任务

private async processTasks(): Promise<void> {
  const running = this.board.getByStatus("running")

  if (running.length < this.maxConcurrency) {
    // 只启动新任务，不超过并发限制
    const pending = this.board.getByStatus("pending")
      .sort((a, b) => b.priority - a.priority)
      .slice(0, this.maxConcurrency - running.length)

    for (const task of pending) {
      await this.executeTask(task)
    }
  }
}
```

## 使用示例

### 基本用法

```typescript
import { WorkQueueSessionProcessor, createAndStart } from "./work-queue/processor"

async function main() {
  const sessionID = "session_123"

  // 创建并启动处理器
  const processor = await createAndStart(sessionID, {
    maxConcurrency: 2,
    llmTimeout: 120_000,
    toolTimeout: 60_000,
  })

  // 提交任务
  const result = await processor.submitLLMTask("分析这段代码")
  console.log(result)

  // 提交工具任务
  await processor.submitToolTask("bash", { command: "npm install" })

  // 提交子任务
  await processor.submitSubtask("explore", "查找所有API端点")

  // 获取状态
  console.log(processor.getStats())

  // 停止处理器
  await processor.stop()
}
```

### 从现有代码迁移

```typescript
// ❌ 旧代码（prompt.ts）
export const loop = fn(Identifier.schema("session"), async (sessionID) => {
  while (true) {
    // 🔴 问题：可能卡住
    if (abort.aborted) break
    const msgs = await MessageV2.stream(sessionID)
    // 处理消息...
  }
})

// ✅ 新代码
export const loop = fn(Identifier.schema("session"), async (sessionID) => {
  const processor = await createAndStart(sessionID)

  // 提交初始任务
  await processor.submitLLMTask("Initial task")

  // 返回处理器实例供后续使用
  return processor
})
```

## 任务类型

| 类型      | 说明     | 默认超时 |
| --------- | -------- | -------- |
| `llm`     | LLM 调用 | 2分钟    |
| `tool`    | 工具执行 | 1分钟    |
| `subtask` | 子任务   | 5分钟    |
| `input`   | 用户输入 | 无超时   |
| `compact` | 会话压缩 | 1分钟    |

## API 参考

### WorkQueueSessionProcessor

| 方法                                      | 说明           |
| ----------------------------------------- | -------------- |
| `start()`                                 | 启动处理器     |
| `stop()`                                  | 停止处理器     |
| `submitTask(input)`                       | 提交任务       |
| `submitLLMTask(goal, priority?)`          | 提交LLM任务    |
| `submitToolTask(name, input, priority?)`  | 提交工具任务   |
| `submitSubtask(agent, prompt, priority?)` | 提交子任务     |
| `cancelTask(taskID)`                      | 取消任务       |
| `getStats()`                              | 获取统计       |
| `getBoard()`                              | 获取任务板     |
| `isActive()`                              | 检查是否运行中 |

### 返回值 (TaskResult)

```typescript
interface TaskResult {
  taskID: string // 任务ID
  type: string // 任务类型
  success: boolean // 是否成功
  output?: string // 输出内容
  error?: string // 错误信息
  duration: number // 执行时长(ms)
}
```

## 监控和调试

### 日志标签

```typescript
const log = Log.create({ service: "work-queue.processor" })

log.info("Task submitted", { taskID: task.id })
log.debug("Task heartbeat", { taskID: task.id })
log.error("Task failed", { taskID: task.id, error: errorMsg })
```

### 统计信息

```typescript
const stats = processor.getStats()
console.log({
  pending: stats.pending, // 待执行
  running: stats.running, // 执行中
  completed: stats.completed, // 已完成
  error: stats.error, // 出错
  blocked: stats.blocked, // 被阻塞
})
```

## 常见问题

### Q: 如何处理任务超时？

```typescript
try {
  const result = await processor.submitLLMTask("分析代码")
  if (!result.success) {
    console.error("任务失败:", result.error)
  }
} catch (error) {
  console.error("任务超时:", error)
}
```

### Q: 如何取消正在运行的任务？

```typescript
const taskID = await processor.submitLLMTask("长时间任务")
// 稍后取消
await processor.cancelTask(taskID)
```

### Q: 如何实现任务依赖？

```typescript
// 提交任务2，依赖任务1
const task1 = await processor.submitTask({ type: "tool", goal: "步骤1" })
const task2 = await processor.submitTask({
  type: "tool",
  goal: "步骤2",
  blockedBy: [task1], // 🔴 需要在 board 中实现
})
```

## 下一步

1. **测试**：运行 `bun test` 验证功能
2. **性能**：监控执行时间和资源使用
3. **集成**：逐步迁移现有代码
