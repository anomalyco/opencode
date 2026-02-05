# Agent Async Work 设计文档

## 概述

基于事件驱动的协程模型重构，实现任务的动态管理、抢占式调度和智能决策。

## 核心架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Event Loop                                      │
│                    (永不阻塞，持续轮询)                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   while (true):                                                         │
│     1. 轮询 Event Queue ← 新事件                                      │
│     2. 轮询 Task Queue ← 待执行任务                                  │
│     3. 轮询 Running Task ← 监控完成                                   │
│                                                                          │
│   Event Loop 只负责：轮询 + 调度，不做判断                               │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## 核心组件

### 1. TaskSummaryBoard (任务看板)

任务摘要驱动，动态管理任务状态。

```typescript
// session/work-queue/types.ts

export type TaskType = "llm" | "tool" | "subtask" | "input" | "compact" | "system"

export type TaskStatus =
  | "created" // 创建待处理
  | "pending" // 等待执行
  | "running" // 执行中
  | "blocked" // 等待依赖
  | "progress" // 执行中（有进度）
  | "paused" // 暂停
  | "completed" // 完成
  | "error" // 错误
  | "cancelled" // 取消

export interface TaskSummary {
  id: string // 唯一标识
  type: TaskType // 任务类型
  goal: string // 任务目标
  progress: number // 完成度 0-100
  status: TaskStatus // 状态
  summary: string // 当前状态摘要
  blockedBy: string[] // 依赖哪些任务
  blocks: string[] // 哪些任务依赖它
  createdAt: number // 创建时间
  updatedAt: number // 更新时间
  checkpoint?: any // 可恢复状态
  result?: any // 执行结果
  error?: string // 错误信息
  priority: number // 优先级
}

export class TaskSummaryBoard {
  // 任务看板
  private tasks: Map<string, TaskSummary> = new Map()

  // 事件总线
  private bus: TaskEventBus

  // 创建任务
  create(summary: Omit<TaskSummary, "createdAt" | "updatedAt" | "status">): TaskSummary

  // 更新任务状态
  update(id: string, updates: Partial<TaskSummary>): void

  // 更新进度
  updateProgress(id: string, progress: number, summary: string): void

  // 阻塞任务
  block(id: string, blockedBy: string[]): void

  // 解除阻塞
  unblock(id: string): void

  // 获取任务
  get(id: string): TaskSummary | undefined

  // 获取所有任务
  getAll(): TaskSummary[]

  // 按状态筛选
  getByStatus(status: TaskStatus): TaskSummary[]

  // 获取当前运行任务
  getCurrentTask(): TaskSummary | null

  // 获取依赖任务
  getDependents(id: string): TaskSummary[]

  // 判断所有任务是否完成
  allDone(ids: string[]): boolean

  // 统计
  stats(): { pending: number; running: number; completed: number; error: number }
}
```

### 2. Event Notification System (事件总线)

任务状态变更通知机制。

```typescript
// session/work-queue/events.ts

export type TaskEventType =
  | "task:created"
  | "task:updated"
  | "task:progress"
  | "task:completed"
  | "task:error"
  | "task:blocked"
  | "task:unblocked"
  | "task:paused"
  | "task:resumed"
  | "task:cancelled"
  | "board:empty"
  | "agent:decision"

export interface TaskEvent {
  type: TaskEventType
  taskID?: string
  timestamp: number
  data?: any
}

export class TaskEventBus {
  // 发布事件
  publish(type: TaskEventType, data?: any): void

  // 订阅事件
  subscribe(type: TaskEventType, callback: (event: TaskEvent) => void): () => void

  // 一次性订阅
  once(type: TaskEventType, callback: (event: TaskEvent) => void): void

  // 发布任务创建事件
  emitTaskCreated(summary: TaskSummary): void

  // 发布任务更新事件
  emitTaskUpdated(summary: TaskSummary, changes: Partial<TaskSummary>): void

  // 发布任务完成事件
  emitTaskCompleted(summary: TaskSummary): void

  // 发布任务进度事件
  emitTaskProgress(summary: TaskSummary, progress: number, summaryText: string): void

  // 发布任务错误事件
  emitTaskError(summary: TaskSummary, error: string): void

  // 发布阻塞事件
  emitTaskBlocked(summary: TaskSummary, blockedBy: string[]): void

  // 发布解除阻塞事件
  emitTaskUnblocked(summary: TaskSummary): void

  // 发布看板空事件
  emitBoardEmpty(): void

  // 发布 agent 决策事件
  emitAgentDecision(action: AgentAction): void
}
```

### 3. Agent Decision Center (主 Agent 决策)

基于任务状态智能决策下一步。

```typescript
// session/work-queue/decision.ts

export type AgentAction =
  | { type: "start_next"; taskID: string }
  | { type: "continue"; taskID: string }
  | { type: "pause"; taskID: string }
  | { type: "resume"; taskID: string }
  | { type: "cancel"; taskID: string }
  | { type: "retry"; taskID: string }
  | { type: "handle_error"; taskIDs: string[] }
  | { type: "unblock"; taskIDs: string[] }
  | { type: "interrupt"; reason: string }
  | { type: "wait" }
  | { type: "idle" }

export interface RelevanceResult {
  isRelated: boolean // 是否相关
  relationType: "same" | "parent" | "child" | "context" | "unrelated"
  confidence: number // 置信度 0-1
  suggestion: "continue" | "interrupt" | "parallel"
  reason: string // 判断理由
}

export class AgentDecisionCenter {
  // 根据看板状态决策下一步
  decideNext(board: TaskSummaryBoard): AgentAction

  // 判断用户输入是否与当前任务相关
  judgeRelevance(userGoal: string, currentTask: TaskSummary | null): RelevanceResult

  // 处理任务完成通知
  handleTaskComplete(board: TaskSummaryBoard, taskID: string): AgentAction

  // 处理任务错误通知
  handleTaskError(board: TaskSummaryBoard, errorTasks: TaskSummary[]): AgentAction

  // 处理用户输入通知
  handleUserInput(board: TaskSummaryBoard, input: UserInput): AgentAction

  // 处理阻塞通知
  handleBlock(board: TaskSummaryBoard, blockedTask: TaskSummary): AgentAction
}
```

### 4. Event Loop (事件循环)

纯调度器，不做业务判断。

```typescript
// session/work-queue/loop.ts

export class EventLoop {
  // 事件队列
  private eventQueue: AsyncQueue<TaskEvent>

  // 任务队列
  private taskQueue: AsyncQueue<string> // 存储 taskID

  // 当前运行任务
  private runningTaskID: string | null = null

  // 看板
  private board: TaskSummaryBoard

  // 决策中心
  private decision: AgentDecisionCenter

  // 启动循环
  start(): void

  // 停止循环
  stop(): void

  // 调度任务
  schedule(taskID: string): void

  // 添加事件
  addEvent(event: TaskEvent): void

  // 执行单个任务
  private executeTask(taskID: string): Promise<void>

  // 核心循环
  private run(): Promise<void>

  // 检查是否可以调度新任务
  private canSchedule(): boolean

  // 任务完成回调
  private onTaskComplete(taskID: string, result: any): void

  // 任务错误回调
  private onTaskError(taskID: string, error: string): void
}
```

### 5. Task Executor (任务执行器)

可中断的任务执行单元。

```typescript
// session/work-queue/executor.ts

export interface TaskExecutor {
  // 任务摘要
  summary: TaskSummary

  // 执行任务
  execute(checkpoint?: any): Promise<any>

  // 保存检查点
  saveCheckpoint(): any

  // 从检查点恢复
  restore(checkpoint: any): void

  // 是否可中断
  isInterruptible(): boolean

  // 设置中断信号
  setAbortSignal(signal: AbortSignal): void
}

// LLM 任务执行器
export class LLMExecutor implements TaskExecutor {
  summary: TaskSummary
  private request: LLMRequest
  private abort: AbortSignal | null = null

  async execute(checkpoint?: any): Promise<any>
  saveCheckpoint(): any
  isInterruptible(): boolean
}

// 工具任务执行器
export class ToolExecutor implements TaskExecutor {
  summary: TaskSummary
  private toolCall: ToolCall
  private abort: AbortSignal | null = null

  async execute(checkpoint?: any): Promise<any>
  saveCheckpoint(): any
  isInterruptible(): boolean
}
```

## 事件类型定义

```typescript
// session/work-queue/event-types.ts

// 系统事件
export const EVENTS = {
  // 任务生命周期
  TASK_CREATED: "task:created",
  TASK_UPDATED: "task:updated",
  TASK_PROGRESS: "task:progress",
  TASK_COMPLETED: "task:completed",
  TASK_ERROR: "task:error",
  TASK_BLOCKED: "task:blocked",
  TASK_UNBLOCKED: "task:unblocked",
  TASK_PAUSED: "task:paused",
  TASK_RESUMED: "task:resumed",
  TASK_CANCELLED: "task:cancelled",

  // 看板事件
  BOARD_EMPTY: "board:empty",
  BOARD_STATS: "board:stats",

  // Agent 决策事件
  AGENT_DECISION: "agent:decision",
  AGENT_IDLE: "agent:idle",
  AGENT_BUSY: "agent:busy",

  // 用户事件 (最高优先级)
  USER_INPUT: "user:input",
  USER_INTERRUPT: "user:interrupt",
  USER_RESUME: "user:resume",
} as const
```

## 执行流程

### 1. 正常任务执行流程

```
1. 创建根任务:
   TaskBoard.create({ type: 'llm', goal: '实现用户登录功能', id: 'T1' })
   Bus.publish('task:created', { taskID: 'T1' })
           │
           ▼
2. 主 Agent 收到通知，决策:
   Agent.decideNext(board) → START_NEXT(T1)
           │
           ▼
3. T1 开始执行 (LLM 流式响应):
   T1.status = 'running'
   Bus.publish('task:updated', { taskID: 'T1', status: 'running' })
           │
           ▼
4. LLM 调用工具 (创建工具任务):
   TaskBoard.create({ type: 'tool', goal: '读取 user.ts', blockedBy: ['T1'], id: 'T2' })
   Bus.publish('task:created', { taskID: 'T2', status: 'blocked' })
   Bus.publish('task:blocked', { taskID: 'T2', blockedBy: ['T1'] })
           │
           ▼
5. T1 继续执行完成:
   T1.status = 'completed'
   Bus.publish('task:completed', { taskID: 'T1' })
           │
           ▼
6. 主 Agent 收到通知，决策:
   Agent.decideNext(board):
     - T1 完成
     - T2 blockedBy T1，现在 T1 完成
     → UNBLOCK(T2)
           │
           ▼
7. T2 开始执行:
   T2.status = 'running'
   Bus.publish('task:unblocked', { taskID: 'T2' })
           │
           ▼
8. T2 完成:
   T2.status = 'completed'
   Bus.publish('task:completed', { taskID: 'T2' })
           │
           ▼
9. 主 Agent 收到通知，决策:
   Agent.decideNext(board):
     - T1, T2 都完成
     - 看板空
     → emitBoardEmpty()
```

### 2. 用户输入处理流程

```
用户输入到达:
   │
   ▼
TaskBoard.create({ type: 'input', goal: '查看代码结构', id: 'U1' })
   │
   ▼
Bus.publish('task:created', { taskID: 'U1' })
   │
   ▼
主 Agent 决策:
Agent.decideNext(board):

  # 检查当前任务
  current = board.getCurrentTask()  # T2 (running)

  # 用户输入摘要
  userGoal = board.get('U1').goal  # "查看代码结构"

  # 判断是否相关
  relevance = judgeRelevance(userGoal, current.summary)

  if (relevance.isRelated):
    # 相关，检查是否可以中断
    if (current.status === 'running' and current.isInterruptible()):
      # 中断当前任务
      T2.status = 'paused'
      T2.checkpoint = save()
      Bus.publish('task:paused', { taskID: 'T2' })
      → START(U1)  # 执行新任务
    else:
      # 不可中断
      → WAIT  # U1 继续等待
  else:
    # 不相关，直接并行
    → START(U1)  # 并行执行
```

### 3. 任务依赖处理流程

```
场景: T1 (LLM) → T2 (工具: read file) → T3 (工具: grep)

1. T1 执行中调用 grep:
   TaskBoard.create({
     type: 'tool',
     goal: '搜索 login 函数',
     blockedBy: ['T1'],  # T1 完成前不能执行
     id: 'T3'
   })
   Bus.publish('task:created', { taskID: 'T3', status: 'blocked' })
   Bus.publish('task:blocked', { taskID: 'T3', blockedBy: ['T1'] })
           │
           ▼
2. T1 完成:
   Bus.publish('task:completed', { taskID: 'T1' })
           │
           ▼
3. 主 Agent 决策:
   Agent.decideNext(board):
     - T1 完成
     - T3 blockedBy [T1]
     → UNBLOCK(['T3'])
           │
           ▼
4. T3 开始执行:
   T3.status = 'running'
   Bus.publish('task:updated', { taskID: 'T3', status: 'running' })
```

## 任务状态流转

```
                    ┌──────────┐
                    │ CREATED  │◄─────────────────────┐
                    └────┬─────┘                       │
                         │                             │
              board.create(task)                       │
                         │                             │
                         ▼                             │
                    ┌──────────┐                       │
           ┌────────│ PENDING  │                       │
           │        └────┬─────┘                       │
           │             │                             │ START(task)
           │             │ Agent.start()               │
           │             ▼                             │
           │        ┌──────────┐                       │
           │        │ RUNNING  │───────────────────────┤
           │        └────┬─────┘                       │
           │             │                             │
           │    ┌────────┼────────┐                    │
           │    ▼        ▼        ▼                    │
           │  PROGRESS  BLOCKED  ERROR                 │
           │    │        │        │                    │
           │    │        │        ▼                    │
           │    │        │    ┌──────────┐            │
           │    │        └───►│  ERROR   │────────────┤
           │    │             └────┬─────┘            │
           │    │                  │                   │
           │    │    Agent.handleError()              │
           │    │                  │                   │
           │    │                  ▼                   │
           │    │            ┌──────────┐              │
           │    │            │  RETRY   │─────────────┤
           │    │            └────┬─────┘             │
           │    │                 │                   │
           │    │      COMPLETE/UNBLOCK              │
           │    │                 │                   │
           │    └─────────────────┴───────────────────┤
           │                                          │
           │            ┌──────────┐                  │
           │            │ PAUSED   │◄────────────────┤
           │            └────┬─────┘                  │
           │                 │                         │ RESUME
           │                 ▼                         │
           │            ┌──────────┐                  │
           └───────────►│ RUNNING  │──────────────────┘
                        └────┬─────┘
                             │
                             │ Agent.done()
                             ▼
                        ┌──────────┐
                        │  DONE    │
                        └──────────┘
```

## 对比旧架构

| 特性     | 原来               | 新架构                |
| -------- | ------------------ | --------------------- |
| 主循环   | `while(true)` 阻塞 | Event Loop 持续轮询   |
| 任务状态 | 变量分散           | TaskSummaryBoard 统一 |
| 进度跟踪 | 无                 | progress 百分比       |
| 依赖关系 | 执行时分析         | 看板 pre-build        |
| 决策机制 | 串行 if-else       | Agent.decideNext()    |
| 用户响应 | 需等待完成         | 动态判断相关性        |
| 事件通知 | 无                 | Bus.publish()         |
| 任务历史 | 无                 | Event[] 记录          |
| 抢占机制 | abort signal       | 抢占 + checkpoint     |

## 改动点

### 新增文件

1. `session/work-queue/types.ts` - 类型定义
2. `session/work-queue/events.ts` - 事件总线
3. `session/work-queue/decision.ts` - 决策中心
4. `session/work-queue/loop.ts` - 事件循环
5. `session/work-queue/executor.ts` - 任务执行器

### 改造文件

1. `session/prompt.ts` - 改为事件驱动
2. `session/processor.ts` - 接入任务看板
3. `session/index.ts` - 支持任务状态查询

### 复用现有

1. `util/queue.ts` - `AsyncQueue` 复用
2. `bus/index.ts` - 事件总线复用
3. `tool/registry.ts` - 工具执行器复用
