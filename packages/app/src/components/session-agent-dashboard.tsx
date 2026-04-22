import { For, Show, createMemo, createSignal, type Accessor, type JSX } from "solid-js"
import { Collapsible } from "@opencode-ai/ui/collapsible"
import { Icon, type IconProps } from "@opencode-ai/ui/icon"
import { useLanguage } from "@/context/language"
import type { Todo, SnapshotFileDiff, ToolPart } from "@opencode-ai/sdk/v2"
import "./session-agent-dashboard.css"

// ── Types ──

export type AgentTaskInfo = {
  id: string
  type: string
  description: string
  status: "pending" | "running" | "completed" | "error"
}

export type AgentDashboardProps = {
  todos: Accessor<Todo[]>
  diffs: Accessor<SnapshotFileDiff[]>
  tasks: Accessor<AgentTaskInfo[]>
  agentName: Accessor<string>
}

// ── Helpers ──

function todoIcon(status: string): IconProps["name"] {
  switch (status) {
    case "completed":
      return "check"
    case "in_progress":
      return "chevron-right"
    case "cancelled":
      return "close"
    default:
      return "selector"
  }
}

function fileStatusLabel(status?: string): string {
  switch (status) {
    case "added":
      return "A"
    case "deleted":
      return "D"
    default:
      return "M"
  }
}

function taskStatusIcon(status: string): IconProps["name"] {
  switch (status) {
    case "running":
      return "status"
    case "completed":
      return "circle-check"
    case "error":
      return "circle-x"
    default:
      return "selector"
  }
}

function basename(path: string): string {
  const idx = path.lastIndexOf("/")
  return idx >= 0 ? path.slice(idx + 1) : path
}

function dirname(path: string): string {
  const idx = path.lastIndexOf("/")
  return idx >= 0 ? path.slice(0, idx) : ""
}

function agentLabel(name: string) {
  if (!name) return ""
  return name[0] ? name[0].toUpperCase() + name.slice(1) : name
}

function agentTone(name: string) {
  const key = name.toLowerCase()
  if (["ayaz", "atlas", "lead", "niggli"].includes(key)) return key
  return "default"
}

function stats(props: AgentDashboardProps) {
  return createMemo(() => {
    const todos = props.todos() ?? []
    const tasks = props.tasks() ?? []
    const diffs = props.diffs() ?? []
    return {
      total: todos.length,
      done: todos.filter((item) => item.status === "completed" || item.status === "cancelled").length,
      pending: todos.filter((item) => item.status === "pending").length,
      active: todos.filter((item) => item.status === "in_progress").length,
      running: tasks.filter((item) => item.status === "running").length,
      queued: tasks.filter((item) => item.status === "pending").length,
      finished: tasks.filter((item) => item.status === "completed").length,
      failed: tasks.filter((item) => item.status === "error").length,
      files: diffs.length,
    }
  })
}

function Metric(props: { label: string; value: string | number; tone?: string }) {
  return (
    <div data-slot="agent-dashboard-metric" data-tone={props.tone}>
      <span data-slot="agent-dashboard-metric-value">{props.value}</span>
      <span data-slot="agent-dashboard-metric-label">{props.label}</span>
    </div>
  )
}

function SummarySection(props: AgentDashboardProps) {
  const language = useLanguage()
  const name = createMemo(() => agentLabel(props.agentName()))
  const data = stats(props)

  return (
    <div data-slot="agent-dashboard-section" data-variant="summary">
      <div data-slot="agent-dashboard-summary" data-agent={agentTone(props.agentName())}>
        <div data-slot="agent-dashboard-summary-copy">
          <span data-slot="agent-dashboard-summary-title">
            {name() || language.t("session.tab.detail")}
          </span>
          <span data-slot="agent-dashboard-summary-body">
            {name()
              ? language.t("session.dashboard.summary.agent", { agent: name() })
              : language.t("session.dashboard.summary.empty")}
          </span>
        </div>
        <div data-slot="agent-dashboard-metrics">
          <Metric label={language.t("session.dashboard.metric.todos")} value={`${data().done}/${data().total}`} />
          <Metric label={language.t("session.dashboard.metric.files")} value={data().files} />
          <Metric label={language.t("session.dashboard.metric.agents")} value={data().running + data().queued} />
        </div>
      </div>
    </div>
  )
}

function AgentFocusSection(props: AgentDashboardProps) {
  const language = useLanguage()
  const data = stats(props)
  const name = createMemo(() => props.agentName().toLowerCase())
  const copy = createMemo(() => {
    if (name() === "ayaz") {
      return {
        title: language.t("session.dashboard.ayaz.title"),
        body: language.t("session.dashboard.ayaz.body"),
        items: [
          { label: language.t("session.dashboard.ayaz.active"), value: data().active + data().running, tone: "brand" },
          { label: language.t("session.dashboard.ayaz.pending"), value: data().pending },
          { label: language.t("session.dashboard.ayaz.files"), value: data().files },
        ],
      }
    }
    if (name() === "atlas") {
      return {
        title: language.t("session.dashboard.atlas.title"),
        body: language.t("session.dashboard.atlas.body"),
        items: [
          { label: language.t("session.dashboard.atlas.running"), value: data().running + data().queued, tone: "brand" },
          { label: language.t("session.dashboard.atlas.completed"), value: data().finished },
          { label: language.t("session.dashboard.atlas.files"), value: data().files },
        ],
      }
    }
    if (name() === "lead") {
      return {
        title: language.t("session.dashboard.lead.title"),
        body: language.t("session.dashboard.lead.body"),
        items: [
          { label: language.t("session.dashboard.lead.running"), value: data().running + data().queued, tone: "brand" },
          { label: language.t("session.dashboard.lead.completed"), value: data().finished },
          { label: language.t("session.dashboard.lead.todos"), value: data().total },
        ],
      }
    }
    if (name() === "niggli") {
      return {
        title: language.t("session.dashboard.niggli.title"),
        body: language.t("session.dashboard.niggli.body"),
        items: [
          { label: language.t("session.dashboard.niggli.pending"), value: data().pending, tone: "brand" },
          { label: language.t("session.dashboard.niggli.done"), value: data().done },
          { label: language.t("session.dashboard.niggli.files"), value: data().files },
        ],
      }
    }
  })

  return (
    <Show when={copy()} keyed>
      {(item) => (
        <div data-slot="agent-dashboard-section">
          <div data-slot="agent-dashboard-focus" data-agent={agentTone(props.agentName())}>
            <div data-slot="agent-dashboard-focus-copy">
              <span data-slot="agent-dashboard-focus-title">{item.title}</span>
              <span data-slot="agent-dashboard-focus-body">{item.body}</span>
            </div>
            <div data-slot="agent-dashboard-metrics">
              <For each={item.items}>{(entry) => <Metric label={entry.label} value={entry.value} tone={entry.tone} />}</For>
            </div>
          </div>
        </div>
      )}
    </Show>
  )
}

// ── Sections ──

function TodoSection(props: { todos: Accessor<Todo[]> }) {
  const language = useLanguage()
  const todos = createMemo(() => props.todos() ?? [])
  const count = createMemo(() => todos().length)
  const completed = createMemo(() => todos().filter((t) => t.status === "completed" || t.status === "cancelled").length)
  const progress = createMemo(() => (count() > 0 ? Math.round((completed() / count()) * 100) : 0))

  return (
    <div data-slot="agent-dashboard-section">
      <Collapsible defaultOpen>
        <Collapsible.Trigger data-slot="agent-dashboard-section-trigger" as={"button" as any}>
          <Icon name="checklist" size="small" />
          <span>{language.t("session.dashboard.todos")}</span>
          <Show when={count() > 0}>
            <span data-slot="agent-dashboard-section-count">
              {completed()}/{count()}
            </span>
          </Show>
          <Collapsible.Arrow />
        </Collapsible.Trigger>
        <Collapsible.Content data-slot="agent-dashboard-section-body">
          <Show when={count() > 0 && progress() < 100}>
            <div data-slot="agent-dashboard-progress">
              <div data-slot="agent-dashboard-progress-fill" style={{ width: `${progress()}%` }} />
            </div>
          </Show>
          <div data-slot="agent-dashboard-section-content">
            <Show
              when={count() > 0}
              fallback={<div data-slot="agent-dashboard-empty">{language.t("session.dashboard.todos.empty")}</div>}
            >
              <For each={todos()}>
                {(todo) => (
                  <div data-slot="agent-dashboard-todo">
                    <div data-slot="agent-dashboard-todo-indicator" data-status={todo.status}>
                      <Icon name={todoIcon(todo.status)} size="small" />
                    </div>
                    <span data-slot="agent-dashboard-todo-content" data-status={todo.status}>
                      {todo.content}
                    </span>
                    <Show when={todo.priority}>
                      <span data-slot="agent-dashboard-todo-priority" data-priority={todo.priority}>
                        {todo.priority}
                      </span>
                    </Show>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </Collapsible.Content>
      </Collapsible>
    </div>
  )
}

function FilesSection(props: { diffs: Accessor<SnapshotFileDiff[]> }) {
  const language = useLanguage()
  const diffs = createMemo(() => props.diffs() ?? [])
  const count = createMemo(() => diffs().length)
  const totalAdd = createMemo(() => diffs().reduce((sum, d) => sum + d.additions, 0))
  const totalDel = createMemo(() => diffs().reduce((sum, d) => sum + d.deletions, 0))

  return (
    <div data-slot="agent-dashboard-section">
      <Collapsible defaultOpen>
        <Collapsible.Trigger data-slot="agent-dashboard-section-trigger" as={"button" as any}>
          <Icon name="edit" size="small" />
          <span>{language.t("session.dashboard.files")}</span>
          <Show when={count() > 0}>
            <span data-slot="agent-dashboard-section-count">{count()}</span>
          </Show>
          <Collapsible.Arrow />
        </Collapsible.Trigger>
        <Collapsible.Content data-slot="agent-dashboard-section-body">
          <div data-slot="agent-dashboard-section-content">
            <Show
              when={count() > 0}
              fallback={<div data-slot="agent-dashboard-empty">{language.t("session.dashboard.files.empty")}</div>}
            >
              <For each={diffs()}>
                {(diff) => (
                  <div data-slot="agent-dashboard-file">
                    <div data-slot="agent-dashboard-file-status" data-status={diff.status ?? "modified"}>
                      {fileStatusLabel(diff.status)}
                    </div>
                    <span data-slot="agent-dashboard-file-path" title={diff.file}>
                      <Show when={dirname(diff.file)}>
                        {(d) => <span style={{ color: "var(--text-weaker)" }}>{d()}/</span>}
                      </Show>
                      {basename(diff.file)}
                    </span>
                    <Show when={diff.additions > 0 || diff.deletions > 0}>
                      <span data-slot="agent-dashboard-file-stats">
                        <Show when={diff.additions > 0}>
                          <span data-tone="add">+{diff.additions}</span>
                        </Show>
                        <Show when={diff.deletions > 0}>
                          <span data-tone="del">-{diff.deletions}</span>
                        </Show>
                      </span>
                    </Show>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </Collapsible.Content>
      </Collapsible>
    </div>
  )
}

function TasksSection(props: { tasks: Accessor<AgentTaskInfo[]> }) {
  const language = useLanguage()
  const [showHistory, setShowHistory] = createSignal(false)

  const allTasks = createMemo(() => props.tasks() ?? [])
  const activeTasks = createMemo(() => allTasks().filter((t) => t.status === "running" || t.status === "pending"))
  const completedTasks = createMemo(() => allTasks().filter((t) => t.status === "completed" || t.status === "error"))
  const displayTasks = createMemo(() => {
    if (showHistory()) return allTasks()
    if (activeTasks().length > 0) return activeTasks()
    return allTasks()
  })
  const hasHistory = createMemo(() => completedTasks().length > 0 && activeTasks().length > 0)

  return (
    <div data-slot="agent-dashboard-section">
      <Collapsible defaultOpen>
        <Collapsible.Trigger data-slot="agent-dashboard-section-trigger" as={"button" as any}>
          <Icon name="providers" size="small" />
          <span>{language.t("session.dashboard.agents")}</span>
          <Show when={activeTasks().length > 0}>
            <span data-slot="agent-dashboard-section-count">{activeTasks().length}</span>
          </Show>
          <Collapsible.Arrow />
        </Collapsible.Trigger>
        <Collapsible.Content data-slot="agent-dashboard-section-body">
          <div data-slot="agent-dashboard-section-content">
            <Show
              when={allTasks().length > 0}
              fallback={<div data-slot="agent-dashboard-empty">{language.t("session.dashboard.agents.empty")}</div>}
            >
              <Show when={hasHistory()}>
                <button
                  data-slot="agent-dashboard-toggle"
                  data-active={showHistory() ? "true" : undefined}
                  onClick={() => setShowHistory(!showHistory())}
                  type="button"
                >
                  {showHistory()
                    ? language.t("session.dashboard.agents.activeOnly")
                    : language.t("session.dashboard.agents.showHistory")}
                </button>
              </Show>
              <For each={displayTasks()}>
                {(task) => (
                  <div data-slot="agent-dashboard-task">
                    <div data-slot="agent-dashboard-task-icon" data-status={task.status}>
                      <Icon name={taskStatusIcon(task.status)} size="small" />
                    </div>
                    <div data-slot="agent-dashboard-task-info">
                      <span data-slot="agent-dashboard-task-type">{task.type}</span>
                      <span data-slot="agent-dashboard-task-desc" title={task.description}>
                        {task.description}
                      </span>
                    </div>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </Collapsible.Content>
      </Collapsible>
    </div>
  )
}

// ── Main Dashboard ──

export function SessionAgentDashboard(props: AgentDashboardProps) {
  const language = useLanguage()

  return (
    <section
      data-component="session-agent-dashboard"
      data-agent={agentTone(props.agentName())}
      aria-label={language.t("session.tab.detail")}
    >
      <SummarySection {...props} />
      <AgentFocusSection {...props} />
      <TodoSection todos={props.todos} />
      <FilesSection diffs={props.diffs} />
      <TasksSection tasks={props.tasks} />
    </section>
  )
}

// ── Data Extraction Helper ──

/**
 * Extract agent task info from task_async ToolParts.
 * Filters to only "start" actions and deduplicates by session/task ID.
 */
export function extractAgentTasks(
  parts: Accessor<Record<string, import("@opencode-ai/sdk/v2").Part[]>>,
  messageIDs: Accessor<string[]>,
): Accessor<AgentTaskInfo[]> {
  return createMemo(() => {
    const ids = messageIDs()
    const result: AgentTaskInfo[] = []
    const seen = new Set<string>()

    for (const msgID of ids) {
      const messageParts = parts()[msgID]
      if (!messageParts) continue

      for (const part of messageParts) {
        if (part.type !== "tool") continue
        const tool = part as ToolPart
        if (tool.tool !== "task_async") continue

        const state = tool.state as any
        const input = state?.input
        if (!input) continue

        // Only track "start" actions (not status/resume/abort/message)
        if (input.action && input.action !== "start") continue

        const taskKey =
          (typeof input.description === "string" ? input.description : "") +
          (typeof input.subagent_type === "string" ? input.subagent_type : "") +
          (state.metadata?.sessionId ?? tool.callID)

        if (seen.has(taskKey)) continue
        seen.add(taskKey)

        result.push({
          id: tool.id,
          type: typeof input.subagent_type === "string" ? input.subagent_type : "unknown",
          description: typeof input.description === "string" ? input.description : "",
          status: state.status as AgentTaskInfo["status"],
        })
      }
    }

    return result
  })
}
