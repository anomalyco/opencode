# OpenCode Agent 调度与 UI 交互优化建议

## 一、Agent 调度逻辑优化

### 1.1 动态 Agent 选择机制

**现状问题:**

- 当前 `Agent.defaultAgent()` 静态选择默认 agent
- 缺少基于任务上下文的智能 agent 推荐

**优化建议:**

```typescript
// src/agent/scheduler.ts (新建)
export namespace AgentScheduler {
  interface TaskContext {
    type: "read" | "write" | "debug" | "explore" | "refactor"
    complexity: "low" | "medium" | "high"
    fileCount: number
    hasTests: boolean
  }

  export async function selectAgent(context: TaskContext): Promise<string> {
    const agents = await Agent.list()

    if (context.type === "explore" || context.complexity === "low") {
      return "explore"
    }

    if (context.type === "debug") {
      return "checker"
    }

    if (context.complexity === "high") {
      const general = agents.find((a) => a.name === "general")
      if (general) return general.name
    }

    return "build"
  }

  export function calculatePriority(agent: Agent.Info, task: TaskContext): number {
    let score = 0

    if (agent.mode === "primary") score += 10
    if (agent.mode === "subagent") score += 5

    const capabilityMatch: Record<string, string[]> = {
      explore: ["grep", "glob", "read", "list"],
      build: ["read", "write", "bash", "edit"],
      checker: ["read", "grep", "bash"],
    }

    const taskCapabilities: Record<string, string[]> = {
      read: ["read"],
      write: ["edit", "write"],
      debug: ["bash", "read", "grep"],
      explore: ["grep", "glob", "list"],
      refactor: ["edit", "bash", "read"],
    }

    const agentCaps = capabilityMatch[agent.name] || []
    const taskCaps = taskCapabilities[task.type] || []

    const matchCount = taskCaps.filter((c) => agentCaps.includes(c)).length
    score += matchCount * 5

    return score
  }
}
```

### 1.2 并发任务调度优化

**现状问题:**

- `ToolScheduler` 依赖分析在每次 execute 时重新计算
- 缺少任务优先级和资源竞争处理

**优化建议:**

```typescript
// src/session/work-queue/priority-scheduler.ts
export class PriorityScheduler {
  private taskQueue: PriorityQueue<Task>
  private running: Map<string, Task> = new Map()
  private readonly MAX_CONCURRENT = 5

  async schedule(task: Task): Promise<void> {
    const priority = this.calculatePriority(task)
    this.taskQueue.enqueue(task, priority)
    this.processQueue()
  }

  private calculatePriority(task: Task): number {
    let score = 0

    if (task.isUserBlocking) score += 100
    if (task.type === "read") score += 50
    if (task.estimatedDuration < 1000) score += 20

    return score
  }

  private async processQueue(): Promise<void> {
    while (this.running.size < this.MAX_CONCURRENT && !this.taskQueue.isEmpty()) {
      const task = this.taskQueue.dequeue()
      this.running.set(task.id, task)
      this.executeTask(task)
    }
  }
}
```

### 1.3 SubAgent 嵌套深度控制

**现状问题:**

- `general` agent 可无限嵌套 subagent
- 缺少递归深度限制和性能保护

**优化建议:**

```typescript
// src/agent/subagent-manager.ts
export namespace SubAgentManager {
  const MAX_DEPTH = 3
  const MAX_SUBAGENTS_PER_SESSION = 10

  interface NestingContext {
    depth: number
    count: number
  }

  export async function canInvokeSubagent(parentAgent: string, context: NestingContext): Promise<boolean> {
    if (context.depth >= MAX_DEPTH) {
      Log.warn("SubAgent depth limit reached", { parentAgent, depth: context.depth })
      return false
    }

    if (context.count >= MAX_SUBAGENTS_PER_SESSION) {
      Log.warn("SubAgent count limit reached", { parentAgent, count: context.count })
      return false
    }

    return true
  }

  export function trackSubagent(context: NestingContext): NestingContext {
    return {
      depth: context.depth + 1,
      count: context.count + 1,
    }
  }
}
```

### 1.4 Agent 性能指标采集

**现状问题:**

- 缺少 agent 执行性能数据
- 无法进行 A/B testing 和优化决策

**优化建议:**

```typescript
// src/agent/metrics.ts
export interface AgentMetrics {
  agentName: string
  totalCalls: number
  avgDuration: number
  successRate: number
  toolUsage: Record<string, number>
  errorTypes: Record<string, number>
}

export namespace AgentMetrics {
  const metrics: Map<string, AgentMetrics> = new Map()

  export async function record(agent: string, duration: number, success: boolean, tools: string[]): Promise<void> {
    const existing = metrics.get(agent) || {
      agentName: agent,
      totalCalls: 0,
      avgDuration: 0,
      successRate: 0,
      toolUsage: {},
      errorTypes: {},
    }

    const total = existing.totalCalls + 1
    existing.totalCalls = total
    existing.avgDuration = (existing.avgDuration * (total - 1) + duration) / total
    existing.successRate = success
      ? (existing.successRate * (total - 1) + 100) / total
      : (existing.successRate * (total - 1)) / total

    for (const tool of tools) {
      existing.toolUsage[tool] = (existing.toolUsage[tool] || 0) + 1
    }

    metrics.set(agent, existing)
  }

  export async function getTopAgents(limit = 5): Promise<AgentMetrics[]> {
    return Array.from(metrics.values())
      .sort((a, b) => b.successRate - a.successRate)
      .slice(0, limit)
  }
}
```

## 二、UI 交互逻辑优化

### 2.1 统一命令面板 (Command Palette)

**现状问题:**

- `/` 命令和 UI 分散
- 缺少快捷键统一入口

**优化建议:**

```typescript
// packages/app/src/components/command-palette.tsx
export function CommandPalette() {
  const [query, setQuery] = createSignal("")
  const [selectedIndex, setSelectedIndex] = createSignal(0)

  const filteredCommands = () => {
    const q = query().toLowerCase()
    return allCommands.filter(
      cmd =>
        cmd.label.toLowerCase().includes(q) ||
        cmd.shortcut?.toLowerCase().includes(q)
    )
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setSelectedIndex(i => Math.min(i + 1, filteredCommands().length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setSelectedIndex(i => Math.max(i - 1, 0))
    } else if (e.key === "Enter") {
      e.preventDefault()
      executeCommand(filteredCommands()[selectedIndex()])
    }
  }

  return (
    <div class="command-palette">
      <input
        type="text"
        value={query()}
        onInput={e => setQuery(e.currentTarget.value)}
        onKeyDown={handleKeyDown}
        placeholder="Search commands..."
        autofocus
      />
      <ul class="command-list">
        <For each={filteredCommands()}>
          {(cmd, index) => (
            <li class={index() === selectedIndex() ? "selected" : ""}>
              <span class="cmd-label">{cmd.label}</span>
              <span class="cmd-shortcut">{cmd.shortcut}</span>
            </li>
          )}
        </For>
      </ul>
    </div>
  )
}
```

### 2.2 Agent 切换状态可视化

**现状问题:**

- Agent 切换静默发生
- 用户无法感知当前 agent 状态

**优化建议:**

```typescript
// packages/app/src/components/agent-indicator.tsx
export function AgentIndicator() {
  const currentAgent = createMemo(() => {
    const session = useCurrentSession()
    return session?.agent
  })

  const agentColor = createMemo(() => {
    const agent = currentAgent()
    return agent?.color || "#6366f1"
  })

  return (
    <div
      class="agent-indicator"
      style={{ "background-color": agentColor() }}
      title={`Current agent: ${currentAgent()?.name}`}
    >
      <span class="agent-icon">
        <AgentIcon agent={currentAgent()} />
      </span>
      <span class="agent-name">{currentAgent()?.name}</span>
      <Show when={currentAgent()?.mode === "subagent"}>
        <span class="subagent-badge">Sub</span>
      </Show>
    </div>
  )
}
```

### 2.3 工具执行进度追踪

**现状问题:**

- 多个工具并行执行时缺少统一进度视图
- 用户不知道正在执行哪些工具

**优化建议:**

```typescript
// packages/app/src/components/tool-progress.tsx
export function ToolProgress() {
  const activeTools = createSignal<ToolExecutionInfo[]>([])
  const progress = createMemo(() => {
    const tools = activeTools()
    if (tools.length === 0) return 0
    const completed = tools.filter(t => t.status === "completed").length
    return (completed / tools.length) * 100
  })

  return (
    <div class="tool-progress-panel">
      <div class="progress-bar">
        <div
          class="progress-fill"
          style={{ width: `${progress()}%` }}
        />
      </div>
      <ul class="tool-list">
        <For each={activeTools()}>
          {tool => (
            <li class={`tool-item ${tool.status}`}>
              <ToolIcon name={tool.name} />
              <span class="tool-name">{tool.name}</span>
              <span class="tool-status">{tool.status}</span>
              <Show when={tool.status === "running"}>
                <LoadingSpinner />
              </Show>
            </li>
          )}
        </For>
      </ul>
    </div>
  )
}
```

### 2.4 智能上下文面板

**现状问题:**

- 相关信息分散在多个 tab
- 缺少智能推荐和快速操作

**优化建议:**

```typescript
// packages/app/src/components/smart-context-panel.tsx
export function SmartContextPanel() {
  const contextItems = createMemo(() => {
    const currentFile = useCurrentFile()
    const recentErrors = useRecentErrors()
    const suggestedActions = useSuggestedActions()

    return [
      ...contextItemsFromFile(currentFile()),
      ...contextItemsFromErrors(recentErrors()),
      ...suggestedActions().map(action => ({
        type: "action" as const,
        label: action.label,
        handler: action.execute,
        relevance: action.score,
      })),
    ].sort((a, b) => (b.relevance || 0) - (a.relevance || 0))
  })

  return (
    <div class="smart-context-panel">
      <h3>Context</h3>
      <ul class="context-list">
        <For each={contextItems()}>
          {item => (
            <li class={`context-item ${item.type}`}>
              <Show when={item.type === "file"}>
                <FileIcon />
                <span>{item.path}</span>
              </Show>
              <Show when={item.type === "error"}>
                <ErrorIcon />
                <span class="error-message">{item.message}</span>
              </Show>
              <Show when={item.type === "action"}>
                <ActionIcon />
                <button onClick={item.handler}>{item.label}</button>
              </Show>
            </li>
          )}
        </For>
      </ul>
    </div>
  )
}
```

### 2.5 会话差异对比视图

**现状问题:**

- `session.diff` 事件触发但 UI 缺少专门视图
- 代码变更review体验不完整

**优化建议:**

```typescript
// packages/app/src/components/session-diff-view.tsx
export function SessionDiffView() {
  const diffs = createSignal<FileDiff[]>([])
  const selectedDiff = createSignal<FileDiff | null>(null)

  const handleSessionDiff = (event: CustomEvent) => {
    diffs(event.detail)
  }

  useEventListener("session.diff", handleSessionDiff)

  return (
    <div class="diff-viewer">
      <div class="diff-sidebar">
        <h4>Changed Files ({diffs().length})</h4>
        <ul class="file-list">
          <For each={diffs()}>
            {diff => (
              <li
                class={selectedDiff()?.path === diff.path ? "selected" : ""}
                onClick={() => selectedDiff(diff)}
              >
                <span class="additions">+{diff.additions}</span>
                <span class="deletions">-{diff.deletions}</span>
                <span class="filename">{diff.path}</span>
              </li>
            )}
          </For>
        </ul>
      </div>
      <div class="diff-content">
        <Show when={selectedDiff()} fallback={<p>Select a file to review</p>}>
          <DiffRenderer
            oldContent={selectedDiff()?.oldContent}
            newContent={selectedDiff()?.newContent}
          />
        </Show>
      </div>
    </div>
  )
}
```

### 2.6 键盘快捷键优化

**现状问题:**

- 快捷键配置分散
- 缺少全局快捷键管理

**优化建议:**

```typescript
// packages/app/src/keyboard-manager.ts
export interface Keybinding {
  id: string
  keys: string[]
  action: () => void
  description: string
  category: "navigation" | "editing" | "agent" | "session"
}

export const defaultKeybindings: Keybinding[] = [
  {
    id: "command-palette",
    keys: ["Cmd+K", "Ctrl+K"],
    action: () => openCommandPalette(),
    description: "Open command palette",
    category: "navigation",
  },
  {
    id: "switch-agent",
    keys: ["Cmd+Shift+A", "Ctrl+Shift+A"],
    action: () => showAgentSwitcher(),
    description: "Switch agent",
    category: "agent",
  },
  {
    id: "new-session",
    keys: ["Cmd+N", "Ctrl+N"],
    action: () => createNewSession(),
    description: "New session",
    category: "session",
  },
  {
    id: "run-tests",
    keys: ["Cmd+T", "Ctrl+T"],
    action: () => runCurrentSessionTests(),
    description: "Run tests",
    category: "editing",
  },
]

export function setupKeybindings(bindings: Keybinding[] = defaultKeybindings) {
  document.addEventListener("keydown", (e) => {
    const pressed = [e.key.toLowerCase()]
    if (e.ctrlKey) pressed.push("ctrl")
    if (e.metaKey) pressed.push("cmd")
    if (e.shiftKey) pressed.push("shift")
    if (e.altKey) pressed.push("alt")

    const keyString = pressed.join("+")

    const match = bindings.find((b) => b.keys.some((k) => k.toLowerCase() === keyString))
    if (match) {
      e.preventDefault()
      match.action()
    }
  })
}
```

## 三、性能优化建议

### 3.1 虚拟化长列表

```typescript
// packages/app/src/components/virtual-list.tsx
export function VirtualList<T>(props: {
  items: T[]
  itemHeight: number
  render: (item: T, index: number) => JSX.Element
  overscan?: number
}) {
  const [scrollTop, setScrollTop] = createSignal(0)
  const containerRef = createSignal<HTMLElement>()

  const visibleItems = createMemo(() => {
    const start = Math.floor(scrollTop() / props.itemHeight)
    const end = Math.min(
      start + Math.ceil((containerRef()?.clientHeight || 0) / props.itemHeight) + (props.overscan || 5),
      props.items.length
    )
    return props.items.slice(start, end).map((item, i) => ({
      item,
      index: start + i,
    }))
  })

  return (
    <div
      ref={containerRef}
      class="virtual-list"
      onScroll={e => setScrollTop(e.currentTarget.scrollTop)}
    >
      <div style={{ height: `${props.items.length * props.itemHeight}px` }}>
        <For each={visibleItems()}>
          {({ item, index }) => (
            <div
              style={{
                position: "absolute",
                top: `${index * props.itemHeight}px`,
                height: `${props.itemHeight}px`,
              }}
            >
              {props.render(item, index)}
            </div>
          )}
        </For>
      </div>
    </div>
  )
}
```

### 3.2 状态批量更新

```typescript
// packages/app/src/utils/batch-update.ts
export function batchedUpdates<T>(fn: () => T): T {
  let updating = false
  let pending: (() => void)[] = []

  const schedule = (update: () => void) => {
    if (updating) {
      pending.push(update)
    } else {
      update()
    }
  }

  const result = (() => {
    updating = true
    try {
      return fn()
    } finally {
      updating = false
      const updates = pending.splice(0)
      updates.forEach((u) => u())
    }
  })()

  return result
}
```

## 四、总结

| 优化方向          | 优先级 | 影响范围 | 预期收益           |
| ----------------- | ------ | -------- | ------------------ |
| 动态 Agent 选择   | 高     | Core     | 提升任务匹配准确率 |
| 并发调度优化      | 高     | Core     | 提升工具执行效率   |
| SubAgent 深度控制 | 中     | Core     | 防止资源耗尽       |
| 命令面板统一      | 高     | UI       | 提升操作效率       |
| 进度可视化        | 中     | UI       | 增强用户信心       |
| 差异对比视图      | 中     | UI       | 改善 code review   |

建议按优先级分阶段实施：

1. 第一阶段：Agent 动态选择 + 命令面板
2. 第二阶段：并发调度优化 + 进度可视化
3. 第三阶段：差异视图 + 性能优化
