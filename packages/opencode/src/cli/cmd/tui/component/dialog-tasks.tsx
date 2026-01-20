import { useDialog } from "@tui/ui/dialog"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { createMemo, createSignal, createResource, createEffect, onMount, Show, onCleanup } from "solid-js"
import { useTheme } from "../context/theme"
import { useSDK } from "../context/sdk"
import { useSync } from "../context/sync"
import { useToast } from "../ui/toast"
import "opentui-spinner/solid"
import { useKV } from "../context/kv"

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

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
}

export function DialogTasks() {
  const dialog = useDialog()
  const { theme } = useTheme()
  const sdk = useSDK()
  const sync = useSync()
  const toast = useToast()
  const kv = useKV()

  const directory = () => sync.data.path.directory || process.cwd()

  const [toKill, setToKill] = createSignal<string>()
  // Start with a hardcoded test task to verify rendering works
  const [tasks, setTasks] = createSignal<TaskInfo[]>([
    {
      id: "test_task_1",
      pid: 12345,
      command: "TEST - If you see this, rendering works!",
      startTime: Date.now(),
      status: "running",
      workdir: "/test",
      description: "Test task to verify rendering",
      logFile: "/test/log",
      reconnectable: true,
    },
  ])

  // Fetch tasks from the API
  const fetchTasks = async () => {
    const dir = directory()
    const url = `${sdk.url}/task?directory=${encodeURIComponent(dir)}`
    const response = await sdk.fetch(url)
    if (!response.ok) return
    const text = await response.text()
    const data = JSON.parse(text) as TaskInfo[]
    setTasks(data)
  }

  // Initial fetch and auto-refresh
  onMount(() => {
    fetchTasks()
  })

  const refreshInterval = setInterval(() => {
    fetchTasks()
  }, 2000)

  onCleanup(() => {
    clearInterval(refreshInterval)
  })

  const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

  const options = createMemo(() => {
    const taskList = tasks() ?? []
    if (taskList.length === 0) {
      return []
    }

    return taskList
      .toSorted((a, b) => b.startTime - a.startTime)
      .map((task) => {
        const isKilling = toKill() === task.id
        const duration = formatDuration(Date.now() - task.startTime)
        const statusText =
          task.status === "running"
            ? `running ${duration}`
            : task.status === "completed"
              ? `completed (exit: ${task.exitCode ?? 0})`
              : `failed (exit: ${task.exitCode ?? "?"})`

        const category =
          task.status === "running" ? "Running" : task.status === "completed" ? "Completed" : "Failed"

        return {
          title: isKilling
            ? `Press again to confirm kill`
            : task.description || task.command.substring(0, 60),
          bg: isKilling ? theme.error : undefined,
          value: task.id,
          category,
          footer: `${formatTime(task.startTime)} | ${statusText}`,
          gutter:
            task.status === "running" ? (
              <Show when={kv.get("animations_enabled", true)} fallback={<text fg={theme.textMuted}>[⋯]</text>}>
                <spinner frames={spinnerFrames} interval={80} color={theme.primary} />
              </Show>
            ) : task.status === "completed" ? (
              <text fg={theme.success}>✓</text>
            ) : (
              <text fg={theme.error}>✗</text>
            ),
        } as DialogSelectOption<string>
      })
  })

  const killTask = async (taskId: string) => {
    try {
      const response = await sdk.fetch(`${sdk.url}/task/${taskId}/kill?directory=${encodeURIComponent(directory())}`, {
        method: "POST",
      })
      if (response.ok) {
        toast.show({ message: "Task killed", variant: "info" })
        fetchTasks()
      } else {
        toast.show({ message: "Failed to kill task", variant: "error" })
      }
    } catch {
      toast.show({ message: "Failed to kill task", variant: "error" })
    }
    setToKill(undefined)
  }

  const removeTask = async (taskId: string) => {
    try {
      const response = await sdk.fetch(`${sdk.url}/task/${taskId}?directory=${encodeURIComponent(directory())}`, {
        method: "DELETE",
      })
      if (response.ok) {
        toast.show({ message: "Task removed", variant: "info" })
        fetchTasks()
      } else {
        toast.show({ message: "Failed to remove task", variant: "error" })
      }
    } catch {
      toast.show({ message: "Failed to remove task", variant: "error" })
    }
  }

  const viewOutput = async (taskId: string) => {
    try {
      const response = await sdk.fetch(
        `${sdk.url}/task/${taskId}/tail?directory=${encodeURIComponent(directory())}&lines=100`,
      )
      if (response.ok) {
        const data = await response.json()
        dialog.replace(() => <DialogTaskOutput taskId={taskId} output={data.output} />)
      }
    } catch {
      toast.show({ message: "Failed to fetch output", variant: "error" })
    }
  }

  onMount(() => {
    dialog.setSize("large")
  })

  return (
    <Show
      when={(tasks() ?? []).length > 0}
      fallback={
        <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
          <box flexDirection="row" justifyContent="space-between">
            <text fg={theme.text} attributes={1}>
              Background Tasks
            </text>
            <text fg={theme.textMuted}>esc</text>
          </box>
          <text fg={theme.textMuted}>No background tasks found.</text>
          <text fg={theme.textMuted}>
            Use the [bg] button on running bash processes to send them to background.
          </text>
        </box>
      }
    >
      <DialogSelect
        title="Background Tasks"
        options={options()}
        onMove={() => {
          setToKill(undefined)
        }}
        onSelect={(option) => {
          viewOutput(option.value)
        }}
        keybind={[
          {
            keybind: { name: "k", ctrl: true, meta: false, shift: false, leader: false },
            title: "kill",
            onTrigger: async (option) => {
              const task = tasks()?.find((t) => t.id === option.value)
              if (!task || task.status !== "running") {
                toast.show({ message: "Task is not running", variant: "warning" })
                return
              }
              if (toKill() === option.value) {
                await killTask(option.value)
                return
              }
              setToKill(option.value)
            },
          },
          {
            keybind: { name: "d", ctrl: true, meta: false, shift: false, leader: false },
            title: "remove",
            onTrigger: async (option) => {
              const task = tasks()?.find((t) => t.id === option.value)
              if (task?.status === "running") {
                toast.show({ message: "Cannot remove running task", variant: "warning" })
                return
              }
              await removeTask(option.value)
            },
          },
          {
            keybind: { name: "o", ctrl: false, meta: false, shift: false, leader: false },
            title: "output",
            onTrigger: async (option) => {
              await viewOutput(option.value)
            },
          },
        ]}
      />
    </Show>
  )
}

function DialogTaskOutput(props: { taskId: string; output: string }) {
  const { theme } = useTheme()

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1} flexGrow={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={1}>
          Task Output: {props.taskId}
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>
      <scrollbox flexGrow={1}>
        <text fg={theme.text} wrapMode="word">
          {props.output || "(No output)"}
        </text>
      </scrollbox>
    </box>
  )
}
