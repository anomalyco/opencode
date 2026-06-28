import { TextAttributes } from "@opentui/core"
import { createMemo, createSignal, For, Show, onMount, onCleanup } from "solid-js"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useSDK } from "../context/sdk"
import { useToast } from "../ui/toast"

type TaskInfo = {
  id: string
  name: string
  status: string
  pid?: number | null
  port?: number | null
  command: string
  createdAt?: number
}

type View = { type: "list" } | { type: "logs"; task: TaskInfo }

function statusColor(status: string, theme: ReturnType<typeof useTheme>["theme"]) {
  switch (status) {
    case "running":
      return theme.success
    case "failed":
      return theme.error
    case "stopped":
    case "completed":
    default:
      return theme.textMuted
  }
}

function statusIcon(status: string) {
  switch (status) {
    case "running":
      return "●"
    case "failed":
      return "✗"
    case "stopped":
      return "■"
    case "completed":
      return "✓"
    default:
      return "○"
  }
}

export function DialogTask() {
  const { theme } = useTheme()
  const dialog = useDialog()
  const sdk = useSDK()
  const toast = useToast()

  const [view, setView] = createSignal<View>({ type: "list" })
  const [tasks, setTasks] = createSignal<TaskInfo[]>([])
  const [logs, setLogs] = createSignal<string>("")
  const [selected, setSelected] = createSignal<number>(0)
  const [loading, setLoading] = createSignal<string | null>(null)
  const [logsLoading, setLogsLoading] = createSignal(false)

  async function fetchTasks() {
    try {
      const resp = await sdk.client.v2.task.list({
        location: { directory: sdk.directory ?? process.cwd() },
      })
      if (resp.data?.data) {
        setTasks(resp.data.data as TaskInfo[])
      }
    } catch (_) {
      // silently ignore refresh errors
    }
  }

  onMount(() => {
    void fetchTasks()
    const interval = setInterval(() => {
      if ((view() as View).type === "list") void fetchTasks()
    }, 3000)
    onCleanup(() => clearInterval(interval))
  })

  async function openLogs(task: TaskInfo) {
    setLogsLoading(true)
    setLogs("")
    setView({ type: "logs", task })
    try {
      const resp = await sdk.client.v2.task.logs({
        taskID: task.id,
        location: { directory: sdk.directory ?? process.cwd() },
      })
      if (resp.data?.data !== undefined) {
        setLogs(resp.data.data)
      } else {
        setLogs("(no logs)")
      }
    } catch (e: any) {
      setLogs(`Error fetching logs: ${e?.message ?? String(e)}`)
    } finally {
      setLogsLoading(false)
    }
  }

  async function doAction(action: "kill" | "stop" | "restart" | "delete", task: TaskInfo) {
    if (loading() !== null) return
    setLoading(task.id + ":" + action)
    try {
      if (action === "kill") {
        await sdk.client.v2.task.kill({
          taskID: task.id,
          location: { directory: sdk.directory ?? process.cwd() },
        })
        toast.show({ message: `Task "${task.name}" killed`, variant: "info" })
      } else if (action === "stop") {
        await sdk.client.v2.task.stop({
          taskID: task.id,
          location: { directory: sdk.directory ?? process.cwd() },
        })
        toast.show({ message: `Task "${task.name}" stopped`, variant: "info" })
      } else if (action === "restart") {
        await sdk.client.v2.task.restart({
          taskID: task.id,
          location: { directory: sdk.directory ?? process.cwd() },
        })
        toast.show({ message: `Task "${task.name}" restarted`, variant: "info" })
      } else if (action === "delete") {
        await sdk.client.v2.task.delete({
          taskID: task.id,
          location: { directory: sdk.directory ?? process.cwd() },
        })
        toast.show({ message: `Task "${task.name}" deleted`, variant: "info" })
      }
      await fetchTasks()
    } catch (e: any) {
      toast.show({ message: `Failed: ${e?.message ?? String(e)}`, variant: "error" })
    } finally {
      setLoading(null)
    }
  }

  const currentView = createMemo(() => view())

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          {currentView().type === "logs"
            ? `Logs — ${(currentView() as { type: "logs"; task: TaskInfo }).task.name}`
            : "Background Tasks"}
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>

      {/* ── List view ──────────────────────────────────────────────────── */}
      <Show when={currentView().type === "list"}>
        <Show
          when={tasks().length > 0}
          fallback={
            <box>
              <text fg={theme.textMuted}>
                No background tasks. Use the agent or CLI to start tasks.
              </text>
              <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
                {" "}
                e.g.  opencode task start --name demo "ping 127.0.0.1 -n 30"
              </text>
            </box>
          }
        >
          <For each={tasks()}>
            {(task, idx) => {
              const isSelected = createMemo(() => selected() === idx())
              const isBusy = createMemo(() => loading()?.startsWith(task.id) ?? false)

              return (
                <box
                  flexDirection="column"
                  paddingLeft={isSelected() ? 1 : 0}
                  onMouseUp={() => setSelected(idx())}
                >
                  {/* Task row */}
                  <box flexDirection="row" gap={2}>
                    {/* Status icon */}
                    <text
                      flexShrink={0}
                      style={{ fg: statusColor(task.status, theme) }}
                    >
                      {statusIcon(task.status)}
                    </text>

                    {/* Name + status */}
                    <box flexDirection="row" gap={1} flexGrow={1}>
                      <text fg={theme.text} attributes={TextAttributes.BOLD}>
                        {task.name}
                      </text>
                      <text style={{ fg: statusColor(task.status, theme) }}>
                        {task.status}
                      </text>
                      <Show when={task.pid}>
                        <text fg={theme.textMuted}>PID:{task.pid}</text>
                      </Show>
                    </box>

                    {/* Actions (only on selected row) */}
                    <Show when={isSelected()}>
                      <box flexDirection="row" gap={1}>
                        <Show when={isBusy()}>
                          <text fg={theme.textMuted}>…</text>
                        </Show>
                        <Show when={!isBusy()}>
                          <text
                            fg={theme.primary}
                            onMouseUp={() => void openLogs(task)}
                            attributes={TextAttributes.UNDERLINE}
                          >
                            [l]ogs
                          </text>
                          <Show when={task.status === "running"}>
                            <text
                              fg={theme.warning}
                              onMouseUp={() => void doAction("kill", task)}
                              attributes={TextAttributes.UNDERLINE}
                            >
                              [k]ill
                            </text>
                            <text
                              fg={theme.warning}
                              onMouseUp={() => void doAction("stop", task)}
                              attributes={TextAttributes.UNDERLINE}
                            >
                              [s]top
                            </text>
                          </Show>
                          <text
                            fg={theme.success}
                            onMouseUp={() => void doAction("restart", task)}
                            attributes={TextAttributes.UNDERLINE}
                          >
                            [r]estart
                          </text>
                          <text
                            fg={theme.error}
                            onMouseUp={() => void doAction("delete", task)}
                            attributes={TextAttributes.UNDERLINE}
                          >
                            [d]elete
                          </text>
                        </Show>
                      </box>
                    </Show>
                  </box>

                  {/* Command line */}
                  <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
                    {"  "}
                    {task.command.length > 60
                      ? task.command.slice(0, 57) + "…"
                      : task.command}
                  </text>
                </box>
              )
            }}
          </For>

          {/* Footer hints */}
          <box flexDirection="row" gap={2} paddingTop={1}>
            <text fg={theme.textMuted}>
              ↑↓ navigate  •  [l] logs  •  [k] kill  •  [s] stop  •  [r] restart  •  [d] delete  •  esc close
            </text>
          </box>
        </Show>
      </Show>

      {/* ── Log view ───────────────────────────────────────────────────── */}
      <Show when={currentView().type === "logs"}>
        <text
          fg={theme.textMuted}
          onMouseUp={() => setView({ type: "list" })}
          attributes={TextAttributes.UNDERLINE}
        >
          ← back to task list  [b]
        </text>
        <Show
          when={!logsLoading()}
          fallback={<text fg={theme.textMuted}>Loading logs…</text>}
        >
          <Show
            when={logs().length > 0}
            fallback={<text fg={theme.textMuted}>(no log output)</text>}
          >
            <box flexDirection="column" gap={0}>
              <text fg={theme.text} wrapMode="word">
                {logs()}
              </text>
            </box>
          </Show>
        </Show>
      </Show>
    </box>
  )
}
