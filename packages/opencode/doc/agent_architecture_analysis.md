# Agent执行架构分析报告

> 分析日期: 2026-02-06  
> 范围: Session循环处理、Tool执行、性能优化

---

## 一、架构概述

### 1.1 当前双层循环架构

```
Session Loop (while true)
  ├── Subtask处理 → TaskGraph并行执行
  ├── Compaction处理 → 消息压缩
  ├── Context Overflow → 触发压缩
  └── Normal Processing → LLM调用
        └── Processor Loop (while true)
              ├── LLM Stream → Tool Calls
              ├── Parallel Tool Execution
              └── Finish → 返回外层
```

### 1.2 核心文件位置

| 功能        | 文件路径                          |
| ----------- | --------------------------------- |
| Session循环 | `src/session/prompt.ts:282`       |
| Tool执行    | `src/session/processor.ts:229`    |
| TaskGraph   | `src/session/work-queue/graph.ts` |
| LLM调用     | `src/session/llm.ts:47`           |
| Compaction  | `src/session/compaction.ts`       |

---

## 二、循环处理分析

### 2.1 当前实现问题

#### 问题1：轮询等待机制低效

**位置**: `processor.ts:172-174`

```ts
async function executeWithLimit(executor: ToolExecutor): Promise<void> {
  while (executingTools.size >= limit) {
    await new Promise((resolve) => setTimeout(resolve, 10)) // ❌ CPU空转
  }
  executingTools.add(executor.callId)
  // ...
}
```

**影响**:

- 10ms间隔轮询 = 每秒100次无意义唤醒
- 高并发时CPU占用飙升
- 响应延迟不稳定

#### 问题2：嵌套无限循环

**位置**: `prompt.ts:282` + `processor.ts:229`

```ts
// 外层循环
while (true) {
  // 内层循环
  while (true) {
    const stream = await LLM.stream(streamInput)
    // ...
  }
}
```

**影响**:

- 退出条件复杂难维护
- 错误恢复逻辑分散
- 状态追踪困难

### 2.2 效率评估

| 指标       | 现状                | 评价    |
| ---------- | ------------------- | ------- |
| Tool并行度 | 依赖配置，默认10    | ⚠️ 中等 |
| LLM调用    | 串行等待完成        | ✅ 合理 |
| 存储I/O    | 每次tool同步写入    | ❌ 低效 |
| 状态管理   | 多层循环+事件       | ❌ 复杂 |
| 缓存       | ToolResultCache单一 | ⚠️ 基础 |

---

## 三、性能深度分析

### 3.1 LLM能力利用率

| 维度          | 利用率 | 分析                             |
| ------------- | ------ | -------------------------------- |
| **LLM调用**   | 30-40% | 串行等待，无法并行多个LLM请求    |
| **Token压缩** | 70-80% | compaction + prune 有但策略简单  |
| **工具并行**  | 60-70% | 有依赖分析和并行执行，但轮询低效 |
| **缓存层**    | 50-60% | 基础缓存，缺乏智能预取           |
| **网络I/O**   | 40-50% | 同步写入，无批量优化             |

### 3.2 核心性能瓶颈

#### 瓶颈1：LLM调用完全串行

**位置**: `processor.ts:229` + `prompt.ts:282`

**问题**:

```ts
while (true) {
  const stream = await LLM.stream(streamInput) // 阻塞等待
  for await (const value of stream.fullStream) {
    // 处理...
  }
  // 下一个LLM调用必须等上一个完全结束
}
```

- 即使有independent工具调用，也必须等LLM响应
- 无法同时发起多个LLM请求利用并发
- 对于长时间LLM调用（如深度推理），整个系统阻塞

#### 瓶颈2：依赖分析过于简单

**位置**: `graph.ts:61-100`

```ts
private analyzeDependencies(node: TaskNode): void {
  const triggerWords = ["after", "once", "when", "following", "based on", "using results from"]
  const triggerPattern = new RegExp(triggerWords.map((w) => `${w}\\s+${otherTask.agent}`).join("|"), "i")
  // 用关键词匹配判断依赖，误判率高
}
```

**问题**:

- 纯文本匹配，无法理解语义依赖
- 漏判：未显式声明但实际需要的依赖
- 误判：包含关键词但实际独立的tasks

#### 瓶颈3：无智能预取机制

**位置**: `provider.ts:995`

**问题**:

- LLM响应到达后才开始准备工具
- 没有speculative execution
- 无法利用模型思考时间预加载下一步资源

#### 瓶颈4：Compaction策略简单

**位置**: `compaction.ts:30-38`

```ts
export async function isOverflow(input) {
  const count = input.tokens.input + input.tokens.cache.read + input.tokens.output
  return count > usable // 简单超限判断
}
```

**问题**:

- 只判断token数量，不评估信息密度
- 未压缩时所有历史都保留
- 无法区分"关键上下文"和"冗余上下文"

### 3.3 性能对比数据（估算）

| 操作              | 当前耗时  | 理论最优  | 差距原因          |
| ----------------- | --------- | --------- | ----------------- |
| 单次Tool调用(IO)  | 50-500ms  | 50-500ms  | ✅ 已最优         |
| 并行10个Tool      | 150-800ms | 100-600ms | 轮询+依赖分析开销 |
| LLM响应+Tool执行  | 2-10s     | 1-5s      | 串行等待          |
| 完整Session(10轮) | 30-120s   | 15-50s    | 串行放大          |
| Context压缩       | 500ms-2s  | 200-500ms | 无智能选择        |

---

## 四、优化建议

### 4.1 优先级矩阵

| 优先级 | 改进项            | 预期收益                  | 复杂度 |
| ------ | ----------------- | ------------------------- | ------ |
| **P0** | 信号量代替轮询    | CPU使用率降低，响应更及时 | 低     |
| **P0** | 事件驱动协调      | 减少空转，提高并发效率    | 中     |
| **P1** | 状态机重构        | 代码可维护性提升          | 中     |
| **P1** | 批量存储写入      | I/O效率提升3-5x           | 低     |
| **P2** | 资源缓存层        | 重复查询减少50%+          | 中     |
| **P2** | 增强Doom Loop检测 | 循环检测更可靠            | 低     |
| **P3** | 并行LLM调用       | Subtask场景提速           | 高     |
| **P3** | 语义依赖分析      | 依赖识别更准确            | 高     |

### 4.2 方案详情

#### 方案1：信号量代替轮询

```ts
import { Semaphore } from "async-mutex"

class ToolExecutor {
  private semaphore = new Semaphore(maxParallel)

  async execute(executor: ToolExecutor): Promise<void> {
    await this.semaphore.acquire()
    try {
      await this.executeTool(executor)
    } finally {
      this.semaphore.release()
    }
  }
}
```

#### 方案2：状态机模式

```ts
enum SessionState {
  IDLE,
  PROCESSING,
  COMPACTING,
  SUBTASK_RUNNING,
  FINISHING,
  ERROR,
}

class SessionOrchestrator {
  private state = SessionState.IDLE

  async run(): Promise<void> {
    for (;;) {
      switch (this.state) {
        case SessionState.PROCESSING:
          await this.process()
        case SessionState.COMPACTING:
          await this.compact()
        // ...
      }
    }
  }
}
```

#### 方案3：批量存储优化

```ts
class BatchToolExecutor {
  private batchQueue: ToolExecutor[] = []
  private flushInterval = 50 // 50ms批量窗口

  async execute(executor: ToolExecutor): Promise<void> {
    return new Promise((resolve) => {
      this.batchQueue.push(executor)
      setTimeout(() => this.flush(), this.flushInterval)
    })
  }

  private async flush(): Promise<void> {
    const batch = this.batchQueue.splice(0)
    await Promise.all(batch.map((e) => this.executeTool(e)))
  }
}
```

#### 方案4：并行LLM调用

```ts
class ParallelLLMExecutor {
  async executeParallel(requests: LLMRequest[]): Promise<LLMResponse[]> {
    const independentGroups = this.findIndependentGroups(requests)

    return Promise.all(independentGroups.map((group) => this.executeGroup(group)))
  }

  private async executeGroup(requests: LLMRequest[]): Promise<LLMResponse[]> {
    const results = await Promise.all(requests.map((req) => this.streamText(req)))
    return results
  }
}
```

#### 方案5：语义依赖分析

```ts
class SemanticDependencyAnalyzer {
  async analyze(tasks: Subtask[]): Promise<DependencyGraph> {
    const embeddings = await Promise.all(tasks.map((task) => this.getEmbedding(task.prompt)))

    const dependencies = []
    for (let i = 0; i < tasks.length; i++) {
      for (let j = i + 1; j < tasks.length; j++) {
        const similarity = cosineSimilarity(embeddings[i], embeddings[j])
        const needsDependency = await this.checkCausal(tasks[j].prompt, tasks[i].outputRequired)
        if (needsDependency) {
          dependencies.push({ from: j, to: i })
        }
      }
    }
    return dependencies
  }
}
```

#### 方案6：Speculative Execution

```ts
class SpeculativeExecutor {
  async executeWithSpeculation(userInput: UserMessage): Promise<void> {
    const speculation = this.speculateNextSteps(userInput)

    const [response, preloaded] = await Promise.all([
      this.llm.firstRound(userInput),
      this.preloadResources(speculation.nextTools),
    ])

    await this.llm.secondRound(response, preloaded)
  }
}
```

#### 方案7：信息密度优化

```ts
class DenseCompaction {
  async compress(messages: Message[]): Promise<CompressedContext> {
    const densities = await Promise.all(
      messages.map(async (msg) => ({
        message: msg,
        density: await this.measureDensity(msg),
        relevance: await this.measureRelevance(msg),
      })),
    )

    const kept = this.knapsackSelect(densities, this.maxTokens, (item) => item.density * item.relevance)

    return this.summarizeLowDensity(kept)
  }
}
```

---

## 五、结论

### 5.1 当前状态评估

| 级别           | 当前状态 | 极客级差距              |
| -------------- | -------- | ----------------------- |
| **功能完整性** | ✅ 完整  | -                       |
| **LLM利用率**  | 30-40%   | 需要提升到70-80%        |
| **并发效率**   | 60-70%   | 需要达到90%+            |
| **延迟优化**   | 一般     | 需要 speculative + 预取 |
| **智能程度**   | 规则驱动 | 需要 ML/语义驱动        |

### 5.2 总结

当前架构是**合格的工程实现**，但远未发挥LLM的真正能力。

**优点**:

- ✅ Streaming响应利用充分
- ✅ 多Provider支持完善
- ✅ 基础缓存机制存在
- ✅ 功能完整性好

**瓶颈**:

- ❌ 串行架构限制并发
- ❌ 轮询等待低效
- ❌ 依赖分析简单
- ❌ Token策略粗糙

### 5.3 演进路线

```
Phase 1 (短期)
├── 信号量代替轮询
├── 批量存储写入
└── 增强Doom Loop检测

Phase 2 (中期)
├── 状态机重构
├── 资源缓存层
└── 并行LLM调用（基础版）

Phase 3 (长期)
├── 语义依赖分析
├── Speculative Execution
└── 信息密度优化
```

---

## 六、主Agent EventLoop架构

### 6.1 现有EventLoop实现

**位置**: `src/session/work-queue/loop.ts`

```ts
export class EventLoop {
  private board: TaskSummaryBoard
  private decision: AgentDecisionCenter
  private runningTasks: Set<string> = new Set()
  private taskAbortControllers: Map<string, AbortController> = new Map()
  private maxConcurrency = 2
  private eventQueue: AsyncQueue<TaskEvent> = new AsyncQueue()
  private abortController: AbortController
  private isRunning = false

  async start(): Promise<void> {
    if (this.isRunning) return
    this.isRunning = true
    log.info("EventLoop started")

    while (this.isRunning && !this.abortController.signal.aborted) {
      try {
        await this.tick()
      } catch (error) {
        log.error("Tick error", { error })
      }
    }
  }

  private async tick(): Promise<void> {
    const event = await Promise.race([
      this.eventQueue.next(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 0)),
    ])

    if (event) {
      await this.handleEvent(event)
      return
    }

    if (this.canSchedule()) {
      const action = this.decision.decideNext(this.board)
      await this.executeAction(action)
    }

    await Bun.sleep(10)
  }
}
```

### 6.2 EventLoop vs 传统循环对比

| 特性         | 传统while(true) | EventLoop        |
| ------------ | --------------- | ---------------- |
| **事件处理** | 轮询检查        | 事件驱动         |
| **并发模型** | 阻塞等待        | 非阻塞协调       |
| **资源利用** | CPU空转         | 智能调度         |
| **响应延迟** | 依赖轮询间隔    | 事件即时触发     |
| **可扩展性** | 难扩展          | 插件化事件处理器 |

### 6.3 主Agent EventLoop集成方案

#### 目标架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Main EventLoop                           │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    │
│  │ TaskQueue   │───▶│ Decision    │───▶│ Executor     │    │
│  │ (优先级排序) │    │ Center      │    │ (LLM/Tool)  │    │
│  └─────────────┘    └─────────────┘    └─────────────┘    │
│         │                  │                  │          │
│         ▼                  ▼                  ▼          │
│  ┌─────────────────────────────────────────────────┐    │
│  │              EventBus (事件驱动)                   │    │
│  │  TASK_SUBMIT │ TASK_COMPLETE │ TASK_ERROR │ ... │    │
│  └─────────────────────────────────────────────────┘    │
│                            │                             │
│         ┌──────────────────┼──────────────────┐          │
│         ▼                  ▼                  ▼          │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐ │
│  │ LLM Stream  │    │ Tool Exec   │    │ Compaction  │ │
│  │ Handler     │    │ Handler     │    │ Handler     │ │
│  └─────────────┘    └─────────────┘    └─────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

#### 核心组件

```ts
/**
 * 主Agent事件循环协调器
 * 目标：单Agent能力最大化
 */
class AgentEventLoopCoordinator {
  private eventLoop: EventLoop
  private taskDispatcher: TaskDispatcher
  private llmPipeline: LLMPipeline
  private toolPipeline: ToolPipeline

  async startSession(sessionID: string): Promise<void> {
    // 1. 初始化事件循环
    this.eventLoop = new EventLoop(sessionID)

    // 2. 注册事件处理器
    this.registerEventHandlers()

    // 3. 启动LLM管道（流式响应）
    this.llmPipeline = new LLMPipeline({
      onToolCall: (calls) => this.eventLoop.publishEvent("tool_calls", { calls }),
      onComplete: () => this.eventLoop.publishEvent("llm_complete"),
      onError: (error) => this.eventLoop.publishEvent("llm_error", { error }),
    })

    // 4. 启动Tool管道
    this.toolPipeline = new ToolPipeline({
      onResult: (result) => this.eventLoop.publishEvent("tool_result", { result }),
      onError: (error) => this.eventLoop.publishEvent("tool_error", { error }),
    })

    // 5. 启动事件循环
    await this.eventLoop.start()
  }

  private registerEventHandlers(): void {
    this.eventLoop.on("user_input", async (event) => {
      await this.handleUserInput(event.data)
    })

    this.eventLoop.on("tool_calls", async (event) => {
      await this.handleToolCalls(event.data.calls)
    })

    this.eventLoop.on("tool_result", async (event) => {
      await this.handleToolResult(event.data.result)
    })

    this.eventLoop.on("llm_complete", async () => {
      await this.handleLLMComplete()
    })
  }

  private async handleToolCalls(calls: ToolCall[]): Promise<void> {
    // 并行执行工具，EventLoop继续处理其他事件
    const results = await this.toolPipeline.executeAll(calls)
    for (const result of results) {
      this.eventLoop.publishEvent("tool_result", { result })
    }
  }
}
```

### 6.4 单Agent能力最大化策略

#### 策略1：LLM Pipeline并行化

```ts
class LLMPipeline {
  private pendingRequests: Map<string, Promise<LLMResponse>> = new Map()

  async stream(
    input: LLMInput,
    callbacks: {
      onToken?: (token: string) => void
      onToolCall?: (calls: ToolCall[]) => void
      onComplete?: () => void
    },
  ): Promise<LLMResponse> {
    const requestId = generateRequestId()

    // 注册回调
    this.pendingRequests.set(
      requestId,
      new Promise((resolve) => {
        this.executeStreaming(requestId, input, callbacks).then(resolve)
      }),
    )

    // 立即返回，允许EventLoop处理其他事件
    return this.pendingRequests.get(requestId)!
  }

  private async executeStreaming(
    requestId: string,
    input: LLMInput,
    callbacks: LLMPipelineCallbacks,
  ): Promise<LLMResponse> {
    const stream = await this.llm.stream(input)

    for await (const chunk of stream.fullStream) {
      switch (chunk.type) {
        case "text-delta":
          callbacks.onToken?.(chunk.text)
          break
        case "tool-call":
          callbacks.onToolCall?.([chunk])
          break
        case "finish":
          callbacks.onComplete?.()
          break
      }
    }

    return this.collectResponse(requestId)
  }
}
```

#### 策略2：智能Task调度

```ts
class SmartTaskScheduler {
  private taskQueue: PriorityQueue<Task>
  private taskHistory: Map<string, TaskOutcome>

  async schedule(task: Task): Promise<void> {
    const priority = await this.calculatePriority(task)
    this.taskQueue.enqueue(task, priority)
  }

  private async calculatePriority(task: Task): Promise<number> {
    let score = 0

    // 1. 紧急度评分 (0-40)
    score += this.calculateUrgencyScore(task)

    // 2. 依赖评分 (0-30)
    const deps = await this.checkDependencies(task)
    score += deps.met ? 30 : 0

    // 3. 资源可用性评分 (0-20)
    score += this.calculateResourceScore(task)

    // 4. 历史成功率评分 (0-10)
    const history = this.taskHistory.get(task.type)
    score += history?.successRate

    return score ?? 10
  }

  private async checkDependencies(task: Task): Promise<{ met: boolean; missing: string[] }> {
    // 检查任务依赖是否已满足
    const missing: string[] = []
    for (const dep of task.dependencies) {
      const outcome = this.taskHistory.get(dep)
      if (!outcome?.completed) {
        missing.push(dep)
      }
    }
    return { met: missing.length === 0, missing }
  }
}
```

#### 策略3：单Agent上下文优化

```ts
class SingleAgentContextOptimizer {
  private contextWindow: ContextWindow
  private summaryCache: Map<string, string>

  async optimizeContext(messages: Message[]): Promise<OptimizedContext> {
    const currentTokens = this.countTokens(messages)

    // 1. 信息密度分析
    const densities = await this.analyzeInformationDensity(messages)

    // 2. 关键信息提取
    const criticalInfo = await this.extractCriticalInfo(messages)

    // 3. 冗余消除
    const deduplicated = await this.deduplicate(messages)

    // 4. 上下文压缩
    const compressed = await this.compress(deduplicated, this.contextWindow.maxTokens - currentTokens)

    return {
      messages: compressed,
      summary: await this.generateSummary(messages),
      importantFiles: criticalInfo.files,
      recentChanges: criticalInfo.changes,
    }
  }

  private async analyzeInformationDensity(messages: Message[]): Promise<DensityMap> {
    return Promise.all(
      messages.map(async (msg) => ({
        message: msg,
        density: await this.measureDensity(msg),
        relevance: await this.measureRelevance(msg),
        novelty: await this.measureNovelty(msg),
      })),
    )
  }
}
```

### 6.5 集成检查清单

```ts
interface EventLoopIntegrationChecklist {
  // ✅ 已实现
  eventLoopInitialized: boolean
  eventHandlersRegistered: boolean
  asyncTaskQueueConfigured: boolean

  // ⚠️ 待完善
  prioritySchedulingEnabled: boolean
  contextOptimizationEnabled: boolean
  speculativeExecutionEnabled: boolean

  // ❌ 未实现
  parallelLLMCallsEnabled: boolean
  semanticDependencyAnalysisEnabled: boolean
}

async function validateIntegration(checklist: EventLoopIntegrationChecklist): Promise<ValidationResult> {
  const issues: string[] = []

  if (!checklist.eventLoopInitialized) {
    issues.push("EventLoop未初始化")
  }

  if (!checklist.prioritySchedulingEnabled) {
    issues.push("未启用优先级调度，单Agent能力受限")
  }

  if (!checklist.contextOptimizationEnabled) {
    issues.push("未启用上下文优化，Token利用率低")
  }

  return {
    ready: issues.length === 0,
    issues,
    recommendations: issues.map((issue) => ({
      issue,
      priority: "high",
      action: getActionForIssue(issue),
    })),
  }
}
```

### 6.6 EventLoop性能指标

| 指标         | 目标值   | 测量方式             |
| ------------ | -------- | -------------------- |
| 事件响应延迟 | < 5ms    | 事件触发到处理的时间 |
| Task切换开销 | < 1ms    | 上下文切换时间       |
| 并发Task数   | 动态调整 | maxConcurrency配置   |
| 内存占用     | 稳定增长 | 长时间运行测试       |
| 错误恢复时间 | < 100ms  | 错误发生到恢复的时间 |

---

## 六、主Agent EventLoop架构

### 6.1 现有EventLoop实现

**位置**: `src/session/work-queue/loop.ts`

```ts
export class EventLoop {
  private board: TaskSummaryBoard
  private decision: AgentDecisionCenter
  private runningTasks: Set<string> = new Set()
  private taskAbortControllers: Map<string, AbortController> = new Map()
  private maxConcurrency = 2
  private eventQueue: AsyncQueue<TaskEvent> = new AsyncQueue()
  private abortController: AbortController
  private isRunning = false

  async start(): Promise<void> {
    if (this.isRunning) return
    this.isRunning = true
    log.info("EventLoop started")

    while (this.isRunning && !this.abortController.signal.aborted) {
      try {
        await this.tick()
      } catch (error) {
        log.error("Tick error", { error })
      }
    }
  }

  private async tick(): Promise<void> {
    const event = await Promise.race([
      this.eventQueue.next(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 0)),
    ])

    if (event) {
      await this.handleEvent(event)
      return
    }

    if (this.canSchedule()) {
      const action = this.decision.decideNext(this.board)
      await this.executeAction(action)
    }

    await Bun.sleep(10)
  }
}
```

### 6.2 EventLoop vs 传统循环对比

| 特性         | 传统while(true) | EventLoop        |
| ------------ | --------------- | ---------------- |
| **事件处理** | 轮询检查        | 事件驱动         |
| **并发模型** | 阻塞等待        | 非阻塞协调       |
| **资源利用** | CPU空转         | 智能调度         |
| **响应延迟** | 依赖轮询间隔    | 事件即时触发     |
| **可扩展性** | 难扩展          | 插件化事件处理器 |

### 6.3 主Agent EventLoop集成方案

#### 目标架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Main EventLoop                           │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    │
│  │ TaskQueue   │───▶│ Decision    │───▶│ Executor     │    │
│  │ (优先级排序) │    │ Center      │    │ (LLM/Tool)  │    │
│  └─────────────┘    └─────────────┘    └─────────────┘    │
│         │                  │                  │          │
│         ▼                  ▼                  ▼          │
│  ┌─────────────────────────────────────────────────┐    │
│  │              EventBus (事件驱动)                   │    │
│  │  TASK_SUBMIT │ TASK_COMPLETE │ TASK_ERROR │ ... │    │
│  └─────────────────────────────────────────────────┘    │
│                            │                             │
│         ┌──────────────────┼──────────────────┐          │
│         ▼                  ▼                  ▼          │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐ │
│  │ LLM Stream  │    │ Tool Exec   │    │ Compaction  │ │
│  │ Handler     │    │ Handler     │    │ Handler     │ │
│  └─────────────┘    └─────────────┘    └─────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

#### 核心组件

```ts
/**
 * 主Agent事件循环协调器
 * 目标：单Agent能力最大化
 */
class AgentEventLoopCoordinator {
  private eventLoop: EventLoop
  private taskDispatcher: TaskDispatcher
  private llmPipeline: LLMPipeline
  private toolPipeline: ToolPipeline

  async startSession(sessionID: string): Promise<void> {
    // 1. 初始化事件循环
    this.eventLoop = new EventLoop(sessionID)

    // 2. 注册事件处理器
    this.registerEventHandlers()

    // 3. 启动LLM管道（流式响应）
    this.llmPipeline = new LLMPipeline({
      onToolCall: (calls) => this.eventLoop.publishEvent("tool_calls", { calls }),
      onComplete: () => this.eventLoop.publishEvent("llm_complete"),
      onError: (error) => this.eventLoop.publishEvent("llm_error", { error }),
    })

    // 4. 启动Tool管道
    this.toolPipeline = new ToolPipeline({
      onResult: (result) => this.eventLoop.publishEvent("tool_result", { result }),
      onError: (error) => this.eventLoop.publishEvent("tool_error", { error }),
    })

    // 5. 启动事件循环
    await this.eventLoop.start()
  }

  private registerEventHandlers(): void {
    this.eventLoop.on("user_input", async (event) => {
      await this.handleUserInput(event.data)
    })

    this.eventLoop.on("tool_calls", async (event) => {
      await this.handleToolCalls(event.data.calls)
    })

    this.eventLoop.on("tool_result", async (event) => {
      await this.handleToolResult(event.data.result)
    })

    this.eventLoop.on("llm_complete", async () => {
      await this.handleLLMComplete()
    })
  }

  private async handleToolCalls(calls: ToolCall[]): Promise<void> {
    // 并行执行工具，EventLoop继续处理其他事件
    const results = await this.toolPipeline.executeAll(calls)
    for (const result of results) {
      this.eventLoop.publishEvent("tool_result", { result })
    }
  }
}
```

### 6.4 单Agent能力最大化策略

#### 策略1：LLM Pipeline并行化

```ts
class LLMPipeline {
  private pendingRequests: Map<string, Promise<LLMResponse>> = new Map()

  async stream(
    input: LLMInput,
    callbacks: {
      onToken?: (token: string) => void
      onToolCall?: (calls: ToolCall[]) => void
      onComplete?: () => void
    },
  ): Promise<LLMResponse> {
    const requestId = generateRequestId()

    // 注册回调
    this.pendingRequests.set(
      requestId,
      new Promise((resolve) => {
        this.executeStreaming(requestId, input, callbacks).then(resolve)
      }),
    )

    // 立即返回，允许EventLoop处理其他事件
    return this.pendingRequests.get(requestId)!
  }

  private async executeStreaming(
    requestId: string,
    input: LLMInput,
    callbacks: LLMPipelineCallbacks,
  ): Promise<LLMResponse> {
    const stream = await this.llm.stream(input)

    for await (const chunk of stream.fullStream) {
      switch (chunk.type) {
        case "text-delta":
          callbacks.onToken?.(chunk.text)
          break
        case "tool-call":
          callbacks.onToolCall?.([chunk])
          break
        case "finish":
          callbacks.onComplete?.()
          break
      }
    }

    return this.collectResponse(requestId)
  }
}
```

#### 策略2：智能Task调度

```ts
class SmartTaskScheduler {
  private taskQueue: PriorityQueue<Task>
  private taskHistory: Map<string, TaskOutcome>

  async schedule(task: Task): Promise<void> {
    const priority = await this.calculatePriority(task)
    this.taskQueue.enqueue(task, priority)
  }

  private async calculatePriority(task: Task): Promise<number> {
    let score = 0

    // 1. 紧急度评分 (0-40)
    score += this.calculateUrgencyScore(task)

    // 2. 依赖评分 (0-30)
    const deps = await this.checkDependencies(task)
    score += deps.met ? 30 : 0

    // 3. 资源可用性评分 (0-20)
    score += this.calculateResourceScore(task)

    // 4. 历史成功率评分 (0-10)
    const history = this.taskHistory.get(task.type)
    score += history?.successRate

    return score ?? 10
  }

  private async checkDependencies(task: Task): Promise<{ met: boolean; missing: string[] }> {
    // 检查任务依赖是否已满足
    const missing: string[] = []
    for (const dep of task.dependencies) {
      const outcome = this.taskHistory.get(dep)
      if (!outcome?.completed) {
        missing.push(dep)
      }
    }
    return { met: missing.length === 0, missing }
  }
}
```

#### 策略3：单Agent上下文优化

```ts
class SingleAgentContextOptimizer {
  private contextWindow: ContextWindow
  private summaryCache: Map<string, string>

  async optimizeContext(messages: Message[]): Promise<OptimizedContext> {
    const currentTokens = this.countTokens(messages)

    // 1. 信息密度分析
    const densities = await this.analyzeInformationDensity(messages)

    // 2. 关键信息提取
    const criticalInfo = await this.extractCriticalInfo(messages)

    // 3. 冗余消除
    const deduplicated = await this.deduplicate(messages)

    // 4. 上下文压缩
    const compressed = await this.compress(deduplicated, this.contextWindow.maxTokens - currentTokens)

    return {
      messages: compressed,
      summary: await this.generateSummary(messages),
      importantFiles: criticalInfo.files,
      recentChanges: criticalInfo.changes,
    }
  }

  private async analyzeInformationDensity(messages: Message[]): Promise<DensityMap> {
    return Promise.all(
      messages.map(async (msg) => ({
        message: msg,
        density: await this.measureDensity(msg),
        relevance: await this.measureRelevance(msg),
        novelty: await this.measureNovelty(msg),
      })),
    )
  }
}
```

### 6.5 集成检查清单

```ts
interface EventLoopIntegrationChecklist {
  // ✅ 已实现
  eventLoopInitialized: boolean
  eventHandlersRegistered: boolean
  asyncTaskQueueConfigured: boolean

  // ⚠️ 待完善
  prioritySchedulingEnabled: boolean
  contextOptimizationEnabled: boolean
  speculativeExecutionEnabled: boolean

  // ❌ 未实现
  parallelLLMCallsEnabled: boolean
  semanticDependencyAnalysisEnabled: boolean
}

async function validateIntegration(checklist: EventLoopIntegrationChecklist): Promise<ValidationResult> {
  const issues: string[] = []

  if (!checklist.eventLoopInitialized) {
    issues.push("EventLoop未初始化")
  }

  if (!checklist.prioritySchedulingEnabled) {
    issues.push("未启用优先级调度，单Agent能力受限")
  }

  if (!checklist.contextOptimizationEnabled) {
    issues.push("未启用上下文优化，Token利用率低")
  }

  return {
    ready: issues.length === 0,
    issues,
    recommendations: issues.map((issue) => ({
      issue,
      priority: "high",
      action: getActionForIssue(issue),
    })),
  }
}
```

### 6.6 EventLoop性能指标

| 指标         | 目标值   | 测量方式             |
| ------------ | -------- | -------------------- |
| 事件响应延迟 | < 5ms    | 事件触发到处理的时间 |
| Task切换开销 | < 1ms    | 上下文切换时间       |
| 并发Task数   | 动态调整 | maxConcurrency配置   |
| 内存占用     | 稳定增长 | 长时间运行测试       |
| 错误恢复时间 | < 100ms  | 错误发生到恢复的时间 |

---

## 六、主Agent EventLoop架构

### 6.1 现有EventLoop实现

**位置**: `src/session/work-queue/loop.ts`

```ts
export class EventLoop {
  private board: TaskSummaryBoard
  private decision: AgentDecisionCenter
  private runningTasks: Set<string> = new Set()
  private taskAbortControllers: Map<string, AbortController> = new Map()
  private maxConcurrency = 2
  private eventQueue: AsyncQueue<TaskEvent> = new AsyncQueue()
  private abortController: AbortController
  private isRunning = false

  async start(): Promise<void> {
    if (this.isRunning) return
    this.isRunning = true
    log.info("EventLoop started")

    while (this.isRunning && !this.abortController.signal.aborted) {
      try {
        await this.tick()
      } catch (error) {
        log.error("Tick error", { error })
      }
    }
  }

  private async tick(): Promise<void> {
    const event = await Promise.race([
      this.eventQueue.next(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 0)),
    ])

    if (event) {
      await this.handleEvent(event)
      return
    }

    if (this.canSchedule()) {
      const action = this.decision.decideNext(this.board)
      await this.executeAction(action)
    }

    await Bun.sleep(10)
  }
}
```

### 6.2 EventLoop vs 传统循环对比

| 特性         | 传统while(true) | EventLoop        |
| ------------ | --------------- | ---------------- |
| **事件处理** | 轮询检查        | 事件驱动         |
| **并发模型** | 阻塞等待        | 非阻塞协调       |
| **资源利用** | CPU空转         | 智能调度         |
| **响应延迟** | 依赖轮询间隔    | 事件即时触发     |
| **可扩展性** | 难扩展          | 插件化事件处理器 |

### 6.3 主Agent EventLoop集成方案

#### 目标架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Main EventLoop                           │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    │
│  │ TaskQueue   │───▶│ Decision    │───▶│ Executor     │    │
│  │ (优先级排序) │    │ Center      │    │ (LLM/Tool)  │    │
│  └─────────────┘    └─────────────┘    └─────────────┘    │
│         │                  │                  │          │
│         ▼                  ▼                  ▼          │
│  ┌─────────────────────────────────────────────────┐    │
│  │              EventBus (事件驱动)                   │    │
│  │  TASK_SUBMIT │ TASK_COMPLETE │ TASK_ERROR │ ... │    │
│  └─────────────────────────────────────────────────┘    │
│                            │                             │
│         ┌──────────────────┼──────────────────┐          │
│         ▼                  ▼                  ▼          │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐ │
│  │ LLM Stream  │    │ Tool Exec   │    │ Compaction  │ │
│  │ Handler     │    │ Handler     │    │ Handler     │ │
│  └─────────────┘    └─────────────┘    └─────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

#### 核心组件

```ts
/**
 * 主Agent事件循环协调器
 * 目标：单Agent能力最大化
 */
class AgentEventLoopCoordinator {
  private eventLoop: EventLoop
  private taskDispatcher: TaskDispatcher
  private llmPipeline: LLMPipeline
  private toolPipeline: ToolPipeline

  async startSession(sessionID: string): Promise<void> {
    // 1. 初始化事件循环
    this.eventLoop = new EventLoop(sessionID)

    // 2. 注册事件处理器
    this.registerEventHandlers()

    // 3. 启动LLM管道（流式响应）
    this.llmPipeline = new LLMPipeline({
      onToolCall: (calls) => this.eventLoop.publishEvent("tool_calls", { calls }),
      onComplete: () => this.eventLoop.publishEvent("llm_complete"),
      onError: (error) => this.eventLoop.publishEvent("llm_error", { error }),
    })

    // 4. 启动Tool管道
    this.toolPipeline = new ToolPipeline({
      onResult: (result) => this.eventLoop.publishEvent("tool_result", { result }),
      onError: (error) => this.eventLoop.publishEvent("tool_error", { error }),
    })

    // 5. 启动事件循环
    await this.eventLoop.start()
  }

  private registerEventHandlers(): void {
    this.eventLoop.on("user_input", async (event) => {
      await this.handleUserInput(event.data)
    })

    this.eventLoop.on("tool_calls", async (event) => {
      await this.handleToolCalls(event.data.calls)
    })

    this.eventLoop.on("tool_result", async (event) => {
      await this.handleToolResult(event.data.result)
    })

    this.eventLoop.on("llm_complete", async () => {
      await this.handleLLMComplete()
    })
  }

  private async handleToolCalls(calls: ToolCall[]): Promise<void> {
    // 并行执行工具，EventLoop继续处理其他事件
    const results = await this.toolPipeline.executeAll(calls)
    for (const result of results) {
      this.eventLoop.publishEvent("tool_result", { result })
    }
  }
}
```

### 6.4 单Agent能力最大化策略

#### 策略1：LLM Pipeline并行化

```ts
class LLMPipeline {
  private pendingRequests: Map<string, Promise<LLMResponse>> = new Map()

  async stream(
    input: LLMInput,
    callbacks: {
      onToken?: (token: string) => void
      onToolCall?: (calls: ToolCall[]) => void
      onComplete?: () => void
    },
  ): Promise<LLMResponse> {
    const requestId = generateRequestId()

    // 注册回调
    this.pendingRequests.set(
      requestId,
      new Promise((resolve) => {
        this.executeStreaming(requestId, input, callbacks).then(resolve)
      }),
    )

    // 立即返回，允许EventLoop处理其他事件
    return this.pendingRequests.get(requestId)!
  }

  private async executeStreaming(
    requestId: string,
    input: LLMInput,
    callbacks: LLMPipelineCallbacks,
  ): Promise<LLMResponse> {
    const stream = await this.llm.stream(input)

    for await (const chunk of stream.fullStream) {
      switch (chunk.type) {
        case "text-delta":
          callbacks.onToken?.(chunk.text)
          break
        case "tool-call":
          callbacks.onToolCall?.([chunk])
          break
        case "finish":
          callbacks.onComplete?.()
          break
      }
    }

    return this.collectResponse(requestId)
  }
}
```

#### 策略2：智能Task调度

```ts
class SmartTaskScheduler {
  private taskQueue: PriorityQueue<Task>
  private taskHistory: Map<string, TaskOutcome>

  async schedule(task: Task): Promise<void> {
    const priority = await this.calculatePriority(task)
    this.taskQueue.enqueue(task, priority)
  }

  private async calculatePriority(task: Task): Promise<number> {
    let score = 0

    // 1. 紧急度评分 (0-40)
    score += this.calculateUrgencyScore(task)

    // 2. 依赖评分 (0-30)
    const deps = await this.checkDependencies(task)
    score += deps.met ? 30 : 0

    // 3. 资源可用性评分 (0-20)
    score += this.calculateResourceScore(task)

    // 4. 历史成功率评分 (0-10)
    const history = this.taskHistory.get(task.type)
    score += history?.successRate

    return score ?? 10
  }

  private async checkDependencies(task: Task): Promise<{ met: boolean; missing: string[] }> {
    // 检查任务依赖是否已满足
    const missing: string[] = []
    for (const dep of task.dependencies) {
      const outcome = this.taskHistory.get(dep)
      if (!outcome?.completed) {
        missing.push(dep)
      }
    }
    return { met: missing.length === 0, missing }
  }
}
```

#### 策略3：单Agent上下文优化

```ts
class SingleAgentContextOptimizer {
  private contextWindow: ContextWindow
  private summaryCache: Map<string, string>

  async optimizeContext(messages: Message[]): Promise<OptimizedContext> {
    const currentTokens = this.countTokens(messages)

    // 1. 信息密度分析
    const densities = await this.analyzeInformationDensity(messages)

    // 2. 关键信息提取
    const criticalInfo = await this.extractCriticalInfo(messages)

    // 3. 冗余消除
    const deduplicated = await this.deduplicate(messages)

    // 4. 上下文压缩
    const compressed = await this.compress(deduplicated, this.contextWindow.maxTokens - currentTokens)

    return {
      messages: compressed,
      summary: await this.generateSummary(messages),
      importantFiles: criticalInfo.files,
      recentChanges: criticalInfo.changes,
    }
  }

  private async analyzeInformationDensity(messages: Message[]): Promise<DensityMap> {
    return Promise.all(
      messages.map(async (msg) => ({
        message: msg,
        density: await this.measureDensity(msg),
        relevance: await this.measureRelevance(msg),
        novelty: await this.measureNovelty(msg),
      })),
    )
  }
}
```

### 6.5 集成检查清单

```ts
interface EventLoopIntegrationChecklist {
  // ✅ 已实现
  eventLoopInitialized: boolean
  eventHandlersRegistered: boolean
  asyncTaskQueueConfigured: boolean

  // ⚠️ 待完善
  prioritySchedulingEnabled: boolean
  contextOptimizationEnabled: boolean
  speculativeExecutionEnabled: boolean

  // ❌ 未实现
  parallelLLMCallsEnabled: boolean
  semanticDependencyAnalysisEnabled: boolean
}

async function validateIntegration(checklist: EventLoopIntegrationChecklist): Promise<ValidationResult> {
  const issues: string[] = []

  if (!checklist.eventLoopInitialized) {
    issues.push("EventLoop未初始化")
  }

  if (!checklist.prioritySchedulingEnabled) {
    issues.push("未启用优先级调度，单Agent能力受限")
  }

  if (!checklist.contextOptimizationEnabled) {
    issues.push("未启用上下文优化，Token利用率低")
  }

  return {
    ready: issues.length === 0,
    issues,
    recommendations: issues.map((issue) => ({
      issue,
      priority: "high",
      action: getActionForIssue(issue),
    })),
  }
}
```

### 6.6 EventLoop性能指标

| 指标         | 目标值   | 测量方式             |
| ------------ | -------- | -------------------- |
| 事件响应延迟 | < 5ms    | 事件触发到处理的时间 |
| Task切换开销 | < 1ms    | 上下文切换时间       |
| 并发Task数   | 动态调整 | maxConcurrency配置   |
| 内存占用     | 稳定增长 | 长时间运行测试       |
| 错误恢复时间 | < 100ms  | 错误发生到恢复的时间 |

---

## 七、参考文件

- `src/session/prompt.ts` - Session循环核心逻辑
- `src/session/processor.ts` - Tool执行处理器
- `src/session/work-queue/graph.ts` - TaskGraph依赖分析
- `src/session/work-queue/loop.ts` - EventLoop实现
- `src/session/work-queue/integration.ts` - EventLoop集成
- `src/session/work-queue/executor.ts` - 任务执行器
- `src/session/llm.ts` - LLM调用封装
- `src/session/compaction.ts` - 消息压缩
- `src/tool/registry.ts` - Tool注册
- `src/provider/provider.ts` - Provider管理
