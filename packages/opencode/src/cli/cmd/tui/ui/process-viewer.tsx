import { TextareaRenderable, TextAttributes, ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { createSignal, createMemo, createEffect, onMount, onCleanup, Show, on } from "solid-js"
import { useTheme } from "../context/theme"
import { useSDK } from "../context/sdk"
import { useSync } from "../context/sync"
import { useDialog, type DialogContext } from "./dialog"
import { useToast } from "./toast"
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
 * Format time for display
 */
function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
}

export type ProcessViewerProps = {
  /**
   * The task ID to view
   */
  taskId: string
  /**
   * Initial output to display (optional, will be fetched if not provided)
   */
  initialOutput?: string
  /**
   * Called when the viewer is closed
   */
  onClose?: () => void
}

/**
 * ProcessViewer component - An interactive terminal viewer for background tasks
 *
 * Features:
 * - Shows scrollable output from a task
 * - Updates in real-time as new output arrives
 * - Allows sending input to the process via TaskManager.input()
 * - Has keybinds for: kill (Ctrl+C), scroll, close (Esc)
 *
 * Usage:
 * ```tsx
 * <ProcessViewer taskId="task_123" />
 * ```
 */
export function ProcessViewer(props: ProcessViewerProps) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const sdk = useSDK()
  const sync = useSync()
  const toast = useToast()
  const kv = useKV()
  const dimensions = useTerminalDimensions()

  const directory = () => sync.data.path.directory || process.cwd()

  // Task state
  const [task, setTask] = createSignal<TaskInfo | null>(null)
  const [output, setOutput] = createSignal(props.initialOutput ?? "")
  const [inputValue, setInputValue] = createSignal("")
  const [now, setNow] = createSignal(Date.now())
  const [confirmKill, setConfirmKill] = createSignal(false)
  const [autoScroll, setAutoScroll] = createSignal(true)

  let scrollbox: ScrollBoxRenderable | undefined
  let textarea: TextareaRenderable | undefined

  // Fetch task info
  const fetchTask = async () => {
    try {
      const response = await sdk.fetch(
        `${sdk.url}/task/${props.taskId}?directory=${encodeURIComponent(directory())}`,
      )
      if (response.ok) {
        const data: TaskInfo = await response.json()
        setTask(data)
      }
    } catch {
      // Silently fail
    }
  }

  // Fetch output
  const fetchOutput = async () => {
    try {
      const response = await sdk.fetch(
        `${sdk.url}/task/${props.taskId}/read?directory=${encodeURIComponent(directory())}`,
      )
      if (response.ok) {
        const data = await response.json()
        const newOutput = data.output ?? ""
        const prevOutput = output()
        setOutput(newOutput)

        // Auto-scroll to bottom if enabled and output changed
        if (autoScroll() && newOutput !== prevOutput && scrollbox) {
          setTimeout(() => {
            if (scrollbox) scrollbox.scrollTo(scrollbox.scrollHeight)
          }, 10)
        }
      }
    } catch {
      // Fall back to tail
      try {
        const response = await sdk.fetch(
          `${sdk.url}/task/${props.taskId}/tail?directory=${encodeURIComponent(directory())}&lines=500`,
        )
        if (response.ok) {
          const data = await response.json()
          const newOutput = data.output ?? ""
          const prevOutput = output()
          setOutput(newOutput)

          if (autoScroll() && newOutput !== prevOutput && scrollbox) {
            setTimeout(() => {
              if (scrollbox) scrollbox.scrollTo(scrollbox.scrollHeight)
            }, 10)
          }
        }
      } catch {
        // Silently fail
      }
    }
  }

  // Send input to task
  const sendInput = async (data: string) => {
    const t = task()
    if (!t || t.status !== "running") {
      toast.show({ message: "Task is not running", variant: "warning" })
      return false
    }

    try {
      const response = await sdk.fetch(
        `${sdk.url}/task/${props.taskId}/input?directory=${encodeURIComponent(directory())}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: data + "\n" }),
        },
      )
      if (response.ok) {
        setInputValue("")
        // Refresh output after sending input
        await fetchOutput()
        return true
      } else {
        toast.show({ message: "Failed to send input", variant: "error" })
        return false
      }
    } catch {
      toast.show({ message: "Failed to send input", variant: "error" })
      return false
    }
  }

  // Kill task
  const killTask = async () => {
    try {
      const response = await sdk.fetch(
        `${sdk.url}/task/${props.taskId}/kill?directory=${encodeURIComponent(directory())}`,
        { method: "POST" },
      )
      if (response.ok) {
        toast.show({ message: "Task killed", variant: "info" })
        setConfirmKill(false)
        await fetchTask()
        await fetchOutput()
      } else {
        toast.show({ message: "Failed to kill task", variant: "error" })
      }
    } catch {
      toast.show({ message: "Failed to kill task", variant: "error" })
    }
    setConfirmKill(false)
  }

  // Computed values
  const elapsed = createMemo(() => {
    const t = task()
    if (!t) return ""
    return formatDuration(now() - t.startTime)
  })

  const statusText = createMemo(() => {
    const t = task()
    if (!t) return "Loading..."
    switch (t.status) {
      case "running":
        return `Running (${elapsed()})`
      case "completed":
        return `Completed (exit: ${t.exitCode ?? 0})`
      case "failed":
        return `Failed (exit: ${t.exitCode ?? "?"})`
      default:
        return t.status
    }
  })

  const statusColor = createMemo(() => {
    const t = task()
    if (!t) return theme.textMuted
    switch (t.status) {
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

  const isRunning = createMemo(() => task()?.status === "running")

  const spinnerFrames = ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"]
  const animationsEnabled = () => kv.get("animations_enabled", true)

  // Height for scrollbox
  const scrollHeight = createMemo(() => Math.floor(dimensions().height / 2) - 8)

  // Setup polling and keyboard handlers
  onMount(() => {
    dialog.setSize("large")

    // Initial fetch
    fetchTask()
    if (!props.initialOutput) {
      fetchOutput()
    }

    // Poll for updates
    const taskInterval = setInterval(fetchTask, 2000)
    const outputInterval = setInterval(() => {
      if (task()?.status === "running") {
        fetchOutput()
      }
    }, 1000)

    // Update elapsed time
    const timeInterval = setInterval(() => setNow(Date.now()), 1000)

    // Focus textarea if running
    setTimeout(() => {
      if (isRunning() && textarea) {
        textarea.focus()
      }
    }, 100)

    onCleanup(() => {
      clearInterval(taskInterval)
      clearInterval(outputInterval)
      clearInterval(timeInterval)
    })
  })

  // Auto-scroll to bottom on initial load
  createEffect(
    on(
      () => output(),
      () => {
        if (autoScroll() && scrollbox) {
          setTimeout(() => {
            if (scrollbox) scrollbox.scrollTo(scrollbox.scrollHeight)
          }, 10)
        }
      },
    ),
  )

  // Keyboard handler
  useKeyboard((evt) => {
    // Ctrl+C to kill (with confirmation)
    if (evt.ctrl && evt.name === "c") {
      if (isRunning()) {
        if (confirmKill()) {
          killTask()
        } else {
          setConfirmKill(true)
          // Reset confirmation after 3 seconds
          setTimeout(() => setConfirmKill(false), 3000)
        }
        evt.preventDefault()
        evt.stopPropagation()
        return
      }
    }

    // Page Up/Down for scrolling
    if (evt.name === "pageup") {
      setAutoScroll(false)
      if (scrollbox) {
        scrollbox.scrollBy(-10)
      }
      evt.preventDefault()
      return
    }

    if (evt.name === "pagedown") {
      if (scrollbox) {
        scrollbox.scrollBy(10)
        // Re-enable auto-scroll if at bottom
        const scrolled = scrollbox.scrollTop
        const max = scrollbox.scrollHeight - scrollbox.height
        if (scrolled >= max - 1) {
          setAutoScroll(true)
        }
      }
      evt.preventDefault()
      return
    }

    // Ctrl+End to scroll to bottom and enable auto-scroll
    if (evt.ctrl && evt.name === "end") {
      setAutoScroll(true)
      if (scrollbox) {
        scrollbox.scrollTo(scrollbox.scrollHeight)
      }
      evt.preventDefault()
      return
    }

    // Ctrl+Home to scroll to top
    if (evt.ctrl && evt.name === "home") {
      setAutoScroll(false)
      if (scrollbox) {
        scrollbox.scrollTo(0)
      }
      evt.preventDefault()
      return
    }
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1} flexGrow={1}>
      {/* Header */}
      <box flexDirection="row" justifyContent="space-between">
        <box flexDirection="row" gap={1} alignItems="center">
          {/* Status indicator */}
          <Show
            when={isRunning()}
            fallback={
              <text fg={statusColor()}>
                {task()?.status === "completed" ? "\u2713" : "\u2717"}
              </text>
            }
          >
            <Show
              when={animationsEnabled()}
              fallback={<text fg={statusColor()}>[\u22EF]</text>}
            >
              <spinner frames={spinnerFrames} interval={80} color={statusColor()} />
            </Show>
          </Show>
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            {task()?.description || task()?.command?.substring(0, 40) || props.taskId}
          </text>
        </box>
        <text fg={theme.textMuted}>esc</text>
      </box>

      {/* Status bar */}
      <box flexDirection="row" gap={2}>
        <text fg={theme.textMuted}>
          PID: <span style={{ fg: theme.text }}>{task()?.pid ?? "?"}</span>
        </text>
        <text fg={theme.textMuted}>
          Status: <span style={{ fg: statusColor() }}>{statusText()}</span>
        </text>
        <text fg={theme.textMuted}>
          Started: <span style={{ fg: theme.text }}>{task() ? formatTime(task()!.startTime) : "?"}</span>
        </text>
        <Show when={!autoScroll()}>
          <text fg={theme.warning}>[Scroll paused]</text>
        </Show>
      </box>

      {/* Output area */}
      <box borderStyle="single" borderColor={theme.border} flexGrow={1}>
        <scrollbox
          ref={(r: ScrollBoxRenderable) => (scrollbox = r)}
          maxHeight={scrollHeight()}
          paddingLeft={1}
          paddingRight={1}
          scrollbarOptions={{ visible: true }}
        >
          <text fg={theme.text} wrapMode="word">
            {output() || "(No output yet)"}
          </text>
        </scrollbox>
      </box>

      {/* Input area (only for running tasks) */}
      <Show when={isRunning()}>
        <box flexDirection="row" gap={1} alignItems="center">
          <text fg={theme.textMuted}>&gt;</text>
          <box flexGrow={1}>
            <textarea
              ref={(r: TextareaRenderable) => (textarea = r)}
              height={1}
              placeholder="Enter input to send to process"
              textColor={theme.text}
              focusedTextColor={theme.text}
              cursorColor={theme.primary}
              onSubmit={() => {
                if (textarea) {
                  const value = textarea.plainText
                  if (value.trim()) {
                    sendInput(value)
                    textarea.setText("")
                  }
                }
              }}
              keyBindings={[{ name: "return", action: "submit" }]}
            />
          </box>
        </box>
      </Show>

      {/* Keybinds footer */}
      <box flexDirection="row" gap={2} flexShrink={0}>
        <Show when={isRunning()}>
          <text>
            <Show
              when={confirmKill()}
              fallback={
                <>
                  <span style={{ fg: theme.text }}>
                    <b>kill</b>{" "}
                  </span>
                  <span style={{ fg: theme.textMuted }}>Ctrl+C</span>
                </>
              }
            >
              <span style={{ fg: theme.error }}>
                <b>Press Ctrl+C again to confirm kill</b>
              </span>
            </Show>
          </text>
          <text>
            <span style={{ fg: theme.text }}>
              <b>send</b>{" "}
            </span>
            <span style={{ fg: theme.textMuted }}>Enter</span>
          </text>
        </Show>
        <text>
          <span style={{ fg: theme.text }}>
            <b>scroll</b>{" "}
          </span>
          <span style={{ fg: theme.textMuted }}>PgUp/PgDn</span>
        </text>
        <text>
          <span style={{ fg: theme.text }}>
            <b>top/bottom</b>{" "}
          </span>
          <span style={{ fg: theme.textMuted }}>Ctrl+Home/End</span>
        </text>
      </box>
    </box>
  )
}

/**
 * Static helper to show the ProcessViewer in a dialog
 */
ProcessViewer.show = (dialog: DialogContext, taskId: string, initialOutput?: string) => {
  dialog.replace(
    () => <ProcessViewer taskId={taskId} initialOutput={initialOutput} />,
    () => {},
  )
}
