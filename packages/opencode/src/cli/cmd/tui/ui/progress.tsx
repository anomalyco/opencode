import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { useTheme } from "../context/theme"
import { useSync } from "../context/sync"
import { useSDK } from "../context/sdk"
import { useKV } from "../context/kv"
import "opentui-spinner/solid"

/**
 * Task info structure matching the task manager
 */
interface TaskInfo {
  id: string
  pid: number
  command: string
  startTime: number
  status: "running" | "completed" | "failed"
  exitCode?: number
  workdir: string
  description?: string
  logFile: string
  reconnectable: boolean
}

/**
 * Format duration in human readable format
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

/**
 * Truncate text to a max length with ellipsis
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength - 1) + "\u2026"
}

export type TaskProgressProps = {
  /**
   * Maximum number of tasks to display at once
   */
  maxTasks?: number
  /**
   * Whether to show completed tasks briefly before they disappear
   */
  showCompleted?: boolean
  /**
   * How long to show completed tasks (in ms)
   */
  completedDuration?: number
  /**
   * Maximum width for task description
   */
  maxDescriptionWidth?: number
  /**
   * Compact mode - single line per task
   */
  compact?: boolean
}

/**
 * TaskProgress component - displays running background tasks with real-time updates
 *
 * Features:
 * - Shows task description/command (truncated)
 * - Displays elapsed time (updating in real-time)
 * - Spinner animation for active tasks
 * - Status indicator (running/completed/failed)
 *
 * Usage:
 * ```tsx
 * <TaskProgress maxTasks={3} compact={true} />
 * ```
 */
export function TaskProgress(props: TaskProgressProps) {
  const { theme } = useTheme()
  const sync = useSync()
  const sdk = useSDK()
  const kv = useKV()

  const maxTasks = () => props.maxTasks ?? 5
  const showCompleted = () => props.showCompleted ?? true
  const completedDuration = () => props.completedDuration ?? 3000
  const maxDescWidth = () => props.maxDescriptionWidth ?? 40
  const compact = () => props.compact ?? false

  // Store for tasks with local state for elapsed time updates
  const [store, setStore] = createStore<{
    tasks: TaskInfo[]
    recentlyCompleted: Set<string>
  }>({
    tasks: [],
    recentlyCompleted: new Set(),
  })

  // Track current time for elapsed duration updates
  const [now, setNow] = createSignal(Date.now())

  const directory = () => sync.data.path.directory || process.cwd()

  // Fetch tasks from API
  const fetchTasks = async () => {
    try {
      const response = await sdk.fetch(`${sdk.url}/task?directory=${encodeURIComponent(directory())}`)
      if (!response.ok) return
      const tasks: TaskInfo[] = await response.json()
      setStore("tasks", tasks)
    } catch {
      // Silently fail - tasks may not be available yet
    }
  }

  // Set up polling for task updates
  onMount(() => {
    fetchTasks()

    // Poll for task updates every 2 seconds
    const pollInterval = setInterval(fetchTasks, 2000)

    // Update elapsed time every second
    const timeInterval = setInterval(() => {
      setNow(Date.now())
    }, 1000)

    onCleanup(() => {
      clearInterval(pollInterval)
      clearInterval(timeInterval)
    })
  })

  // Listen for task events for real-time updates
  onMount(() => {
    const handleTaskCreated = () => {
      fetchTasks()
    }

    const handleTaskCompleted = (evt: any) => {
      if (showCompleted()) {
        const taskId = evt.properties?.id
        if (taskId) {
          setStore(
            produce((draft) => {
              draft.recentlyCompleted.add(taskId)
            }),
          )
          // Remove from recently completed after duration
          setTimeout(() => {
            setStore(
              produce((draft) => {
                draft.recentlyCompleted.delete(taskId)
              }),
            )
          }, completedDuration())
        }
      }
      fetchTasks()
    }

    const handleTaskKilled = () => {
      fetchTasks()
    }

    // Subscribe to SDK events
    const unsubs = [
      sdk.event.on("task.created" as any, handleTaskCreated),
      sdk.event.on("task.completed" as any, handleTaskCompleted),
      sdk.event.on("task.killed" as any, handleTaskKilled),
    ]

    onCleanup(() => {
      unsubs.forEach((unsub) => unsub())
    })
  })

  // Filter and sort tasks - running first, then recently completed
  const visibleTasks = createMemo(() => {
    const running = store.tasks
      .filter((t) => t.status === "running")
      .toSorted((a, b) => b.startTime - a.startTime)

    const completed = showCompleted()
      ? store.tasks
          .filter((t) => t.status !== "running" && store.recentlyCompleted.has(t.id))
          .toSorted((a, b) => b.startTime - a.startTime)
      : []

    return [...running, ...completed].slice(0, maxTasks())
  })

  const runningCount = createMemo(() => store.tasks.filter((t) => t.status === "running").length)

  // Spinner frames for animation
  const spinnerFrames = ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"]
  const animationsEnabled = () => kv.get("animations_enabled", true)

  return (
    <Show when={visibleTasks().length > 0}>
      <box flexDirection="column" gap={compact() ? 0 : 1}>
        <For each={visibleTasks()}>
          {(task) => {
            const elapsed = createMemo(() => formatDuration(now() - task.startTime))
            const description = createMemo(() => {
              const desc = task.description || task.command
              return truncate(desc, maxDescWidth())
            })

            const statusColor = createMemo(() => {
              switch (task.status) {
                case "running":
                  return theme.primary
                case "completed":
                  return theme.success
                case "failed":
                  return theme.error
                default:
                  return theme.textMuted
              }
            })

            const statusIcon = createMemo(() => {
              switch (task.status) {
                case "running":
                  return null // Will use spinner
                case "completed":
                  return "\u2713"
                case "failed":
                  return "\u2717"
                default:
                  return "\u2022"
              }
            })

            return (
              <box flexDirection="row" gap={1} alignItems="center">
                {/* Status indicator - spinner for running, icon for completed/failed */}
                <box width={3} flexShrink={0} justifyContent="center">
                  <Show
                    when={task.status === "running"}
                    fallback={
                      <text fg={statusColor()} flexShrink={0}>
                        {statusIcon()}
                      </text>
                    }
                  >
                    <Show
                      when={animationsEnabled()}
                      fallback={
                        <text fg={statusColor()} flexShrink={0}>
                          [...]
                        </text>
                      }
                    >
                      <spinner frames={spinnerFrames} interval={80} color={statusColor()} />
                    </Show>
                  </Show>
                </box>

                {/* Task description */}
                <text fg={task.status === "running" ? theme.text : theme.textMuted} flexShrink={1}>
                  {description()}
                </text>

                {/* Elapsed time */}
                <text fg={theme.textMuted} flexShrink={0}>
                  {elapsed()}
                </text>

                {/* Exit code for completed tasks */}
                <Show when={task.status !== "running" && task.exitCode !== undefined}>
                  <text fg={task.exitCode === 0 ? theme.success : theme.error} flexShrink={0}>
                    (exit: {task.exitCode})
                  </text>
                </Show>
              </box>
            )
          }}
        </For>

        {/* Show overflow indicator if more tasks than maxTasks */}
        <Show when={runningCount() > maxTasks()}>
          <text fg={theme.textMuted}>
            +{runningCount() - maxTasks()} more task{runningCount() - maxTasks() > 1 ? "s" : ""} running
          </text>
        </Show>
      </box>
    </Show>
  )
}

/**
 * TaskProgressBadge - Compact badge showing number of running tasks
 *
 * Useful for status bars or headers where space is limited
 */
export function TaskProgressBadge() {
  const { theme } = useTheme()
  const sync = useSync()
  const sdk = useSDK()
  const kv = useKV()

  const [runningCount, setRunningCount] = createSignal(0)

  const directory = () => sync.data.path.directory || process.cwd()

  const fetchTaskCount = async () => {
    try {
      const response = await sdk.fetch(`${sdk.url}/task?directory=${encodeURIComponent(directory())}`)
      if (!response.ok) return
      const tasks: TaskInfo[] = await response.json()
      setRunningCount(tasks.filter((t) => t.status === "running").length)
    } catch {
      // Silently fail
    }
  }

  onMount(() => {
    fetchTaskCount()
    const interval = setInterval(fetchTaskCount, 2000)
    onCleanup(() => clearInterval(interval))
  })

  const spinnerFrames = ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"]
  const animationsEnabled = () => kv.get("animations_enabled", true)

  return (
    <Show when={runningCount() > 0}>
      <box flexDirection="row" gap={1} alignItems="center">
        <Show
          when={animationsEnabled()}
          fallback={
            <text fg={theme.primary} flexShrink={0}>
              [...]
            </text>
          }
        >
          <spinner frames={spinnerFrames} interval={80} color={theme.primary} />
        </Show>
        <text fg={theme.text}>
          {runningCount()} task{runningCount() > 1 ? "s" : ""}
        </text>
      </box>
    </Show>
  )
}

/**
 * TaskProgressInline - Single-line progress indicator for embedding in status areas
 *
 * Shows the most recent running task with a spinner and truncated description
 */
export function TaskProgressInline(props: { maxWidth?: number }) {
  const { theme } = useTheme()
  const sync = useSync()
  const sdk = useSDK()
  const kv = useKV()

  const maxWidth = () => props.maxWidth ?? 30

  const [latestTask, setLatestTask] = createSignal<TaskInfo | null>(null)
  const [now, setNow] = createSignal(Date.now())

  const directory = () => sync.data.path.directory || process.cwd()

  const fetchLatestTask = async () => {
    try {
      const response = await sdk.fetch(`${sdk.url}/task?directory=${encodeURIComponent(directory())}`)
      if (!response.ok) return
      const tasks: TaskInfo[] = await response.json()
      const running = tasks
        .filter((t) => t.status === "running")
        .toSorted((a, b) => b.startTime - a.startTime)
      setLatestTask(running[0] ?? null)
    } catch {
      // Silently fail
    }
  }

  onMount(() => {
    fetchLatestTask()
    const pollInterval = setInterval(fetchLatestTask, 2000)
    const timeInterval = setInterval(() => setNow(Date.now()), 1000)

    onCleanup(() => {
      clearInterval(pollInterval)
      clearInterval(timeInterval)
    })
  })

  const elapsed = createMemo(() => {
    const task = latestTask()
    if (!task) return ""
    return formatDuration(now() - task.startTime)
  })

  const description = createMemo(() => {
    const task = latestTask()
    if (!task) return ""
    const desc = task.description || task.command
    return truncate(desc, maxWidth())
  })

  const spinnerFrames = ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"]
  const animationsEnabled = () => kv.get("animations_enabled", true)

  return (
    <Show when={latestTask()}>
      <box flexDirection="row" gap={1} alignItems="center">
        <Show
          when={animationsEnabled()}
          fallback={
            <text fg={theme.primary} flexShrink={0}>
              [...]
            </text>
          }
        >
          <spinner frames={spinnerFrames} interval={80} color={theme.primary} />
        </Show>
        <text fg={theme.textMuted}>{description()}</text>
        <text fg={theme.textMuted}>{elapsed()}</text>
      </box>
    </Show>
  )
}
