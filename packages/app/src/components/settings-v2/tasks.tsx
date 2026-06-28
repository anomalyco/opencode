import {
  createSignal,
  createResource,
  createEffect,
  onCleanup,
  For,
  Show,
  createMemo,
} from "solid-js"
import { useSDK } from "@/context/sdk"
import { useServer } from "@/context/server"
import { authTokenFromCredentials } from "@/utils/server"
import { useLanguage } from "@/context/language"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"

export function SettingsTasksV2() {
  const sdk = useSDK()
  const server = useServer()
  const language = useLanguage()

  const [tasks, { refetch }] = createResource(async () => {
    const res = await sdk().client.tasks.list({
      query: { location: { directory: sdk().directory } },
    })
    return res.data?.data ?? []
  })

  const [selectedId, setSelectedId] = createSignal<string | null>(null)
  const [logText, setLogText] = createSignal("")
  const [autoScroll, setAutoScroll] = createSignal(true)

  let logContainer: HTMLPreElement | undefined

  const selectedTask = createMemo(() => {
    const id = selectedId()
    if (!id || !tasks()) return undefined
    return tasks()?.find((t) => t.id === id)
  })

  // Poll tasks list every 3 seconds for dynamic status updates
  const pollInterval = setInterval(() => {
    refetch()
  }, 3000)
  onCleanup(() => clearInterval(pollInterval))

  // Build the auth query parameter for event source streaming
  const authQuery = createMemo(() => {
    const current = server.current
    if (!current) return ""
    const { username, password } = current.http
    if (!password) return ""
    const token = authTokenFromCredentials({ username, password })
    return `?auth_token=${encodeURIComponent(token)}&location[directory]=${encodeURIComponent(sdk().directory)}`
  })

  // Handle log fetching and streaming
  createEffect(() => {
    const id = selectedId()
    if (!id) return

    setLogText("Loading logs...\n")

    // Fetch initial logs backlog
    sdk()
      .client.tasks.logs({
        path: { taskID: id },
        query: { location: { directory: sdk().directory }, lines: 200 },
      })
      .then((res) => {
        if (res.data) {
          setLogText(res.data.data)
        } else {
          setLogText("")
        }
      })
      .catch(() => setLogText("Failed to load log backlog.\n"))

    // Connect to SSE stream for live updates
    const streamUrl = `${sdk().url}/api/task/${id}/logs/stream${authQuery()}`
    const source = new EventSource(streamUrl)

    source.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data)
        setLogText((prev) => prev + parsed.data + "\n")
      } catch {
        setLogText((prev) => prev + event.data + "\n")
      }
    }

    source.onerror = () => {
      source.close()
    }

    onCleanup(() => {
      source.close()
    })
  })

  // Auto-scroll log console
  createEffect(() => {
    if (autoScroll() && logContainer && logText()) {
      logContainer.scrollTop = logContainer.scrollHeight
    }
  })

  const runAction = async (
    action: "stop" | "restart" | "kill" | "delete" | "start",
    id: string,
    event?: MouseEvent
  ) => {
    event?.stopPropagation()
    try {
      if (action === "start") {
        const t = tasks()?.find((x) => x.id === id)
        if (t) {
          await sdk().client.tasks.start({
            query: { location: { directory: sdk().directory } },
            body: { name: t.name, command: t.command, cwd: t.cwd, port: t.port },
          })
        }
      } else if (action === "stop") {
        await sdk().client.tasks.stop({
          query: { location: { directory: sdk().directory } },
          path: { taskID: id },
        })
      } else if (action === "restart") {
        await sdk().client.tasks.restart({
          query: { location: { directory: sdk().directory } },
          path: { taskID: id },
        })
      } else if (action === "kill") {
        await sdk().client.tasks.kill({
          query: { location: { directory: sdk().directory } },
          path: { taskID: id },
        })
      } else if (action === "delete") {
        await sdk().client.tasks.delete({
          query: { location: { directory: sdk().directory } },
          path: { taskID: id },
        })
        if (selectedId() === id) {
          setSelectedId(null)
        }
      }
      refetch()
    } catch (err) {
      console.error(`Failed to execute ${action} on task ${id}:`, err)
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case "running":
        return "bg-icon-success-base"
      case "completed":
        return "bg-icon-info-base"
      case "failed":
        return "bg-icon-critical-base"
      default:
        return "bg-border-strong"
    }
  }

  return (
    <div class="flex h-full w-full select-none text-text-strong bg-background-base overflow-hidden">
      {/* Left panel: Task List */}
      <div class="w-80 border-r border-border-weaker flex flex-col h-full bg-background-strong">
        <div class="p-4 border-b border-border-weaker flex items-center justify-between">
          <span class="font-bold text-sm uppercase tracking-wider text-text-weak">Background Tasks</span>
          <IconButton icon="refresh" variant="ghost" onClick={() => refetch()} aria-label="Refresh tasks" />
        </div>
        <div class="flex-1 overflow-y-auto p-2 flex flex-col gap-2">
          <Show
            when={tasks() && tasks()!.length > 0}
            fallback={
              <div class="p-8 text-center text-text-weak text-xs flex flex-col items-center gap-2">
                <Icon name="status" size="large" class="opacity-55" />
                No background tasks found.
              </div>
            }
          >
            <For each={tasks()}>
              {(task) => (
                <div
                  onClick={() => setSelectedId(task.id)}
                  class="p-3 rounded-lg flex flex-col gap-1.5 cursor-pointer transition-all border group"
                  classList={{
                    "bg-background-base border-border-weak shadow-sm": selectedId() === task.id,
                    "bg-transparent border-transparent hover:bg-background-base/50": selectedId() !== task.id,
                  }}
                >
                  <div class="flex items-center justify-between w-full">
                    <div class="flex items-center gap-2 min-w-0">
                      <div class={`size-2 rounded-full ${getStatusColor(task.status)} flex-shrink-0`} />
                      <span class="font-semibold text-sm truncate">{task.name}</span>
                    </div>
                    {/* Inline list controls */}
                    <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Show
                        when={task.status === "running"}
                        fallback={
                          <>
                            <Tooltip value="Start Task">
                              <IconButton
                                icon="play"
                                variant="ghost"
                                class="size-6 rounded-md text-icon-success-base hover:bg-icon-success-base/10"
                                onClick={(e) => runAction("start", task.id, e)}
                              />
                            </Tooltip>
                            <Tooltip value="Delete Record">
                              <IconButton
                                icon="trash"
                                variant="ghost"
                                class="size-6 rounded-md text-icon-critical-base hover:bg-icon-critical-base/10"
                                onClick={(e) => runAction("delete", task.id, e)}
                              />
                            </Tooltip>
                          </>
                        }
                      >
                        <Tooltip value="Stop Task">
                          <IconButton
                            icon="stop"
                            variant="ghost"
                            class="size-6 rounded-md text-icon-warning-base hover:bg-icon-warning-base/10"
                            onClick={(e) => runAction("stop", task.id, e)}
                          />
                        </Tooltip>
                        <Tooltip value="Restart Task">
                          <IconButton
                            icon="refresh"
                            variant="ghost"
                            class="size-6 rounded-md text-icon-info-base hover:bg-icon-info-base/10"
                            onClick={(e) => runAction("restart", task.id, e)}
                          />
                        </Tooltip>
                      </Show>
                    </div>
                  </div>
                  <code class="text-xs text-text-weak truncate bg-background-strong/45 px-1.5 py-0.5 rounded border border-border-weaker">
                    {task.command}
                  </code>
                  <div class="flex items-center justify-between text-[10px] text-text-weak">
                    <span>{task.id.slice(0, 12)}...</span>
                    <Show when={task.port}>
                      <span class="bg-icon-info-base/10 text-icon-info-base px-1.5 py-0.5 rounded-full font-medium">
                        Port: {task.port}
                      </span>
                    </Show>
                  </div>
                </div>
              )}
            </For>
          </Show>
        </div>
      </div>

      {/* Right panel: Details and Streaming Logs */}
      <div class="flex-1 flex flex-col h-full bg-background-base overflow-hidden">
        <Show
          when={selectedTask()}
          fallback={
            <div class="flex-1 flex flex-col items-center justify-center text-text-weak gap-3">
              <div class="size-16 rounded-full bg-background-strong border border-border-weaker flex items-center justify-center shadow-inner">
                <Icon name="terminal" size="large" class="text-text-weak opacity-70" />
              </div>
              <div class="text-center">
                <p class="font-bold text-sm text-text-strong">No Task Selected</p>
                <p class="text-xs text-text-weak mt-1">Select a background task from the list to view details and live logs.</p>
              </div>
            </div>
          }
        >
          {/* Selected Task Details */}
          <div class="p-4 border-b border-border-weaker flex flex-col gap-3">
            <div class="flex items-center justify-between w-full">
              <div class="flex flex-col gap-0.5">
                <div class="flex items-center gap-2.5">
                  <h2 class="text-lg font-bold">{selectedTask()!.name}</h2>
                  <span
                    class="px-2 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider"
                    classList={{
                      "bg-icon-success-base/10 text-icon-success-base": selectedTask()!.status === "running",
                      "bg-icon-critical-base/10 text-icon-critical-base": selectedTask()!.status === "failed",
                      "bg-border-strong/20 text-text-weak": selectedTask()!.status !== "running" && selectedTask()!.status !== "failed",
                    }}
                  >
                    {selectedTask()!.status}
                  </span>
                </div>
                <span class="text-xs text-text-weak">Task ID: {selectedTask()!.id}</span>
              </div>
              <div class="flex items-center gap-2">
                <Show
                  when={selectedTask()!.status === "running"}
                  fallback={
                    <Button variant="default" onClick={() => runAction("start", selectedTask()!.id)}>
                      <Icon name="play" /> Start
                    </Button>
                  }
                >
                  <Button variant="ghost" class="border border-border-weak" onClick={() => runAction("stop", selectedTask()!.id)}>
                    <Icon name="stop" /> Stop
                  </Button>
                  <Button variant="ghost" class="text-icon-critical-base hover:bg-icon-critical-base/10" onClick={() => runAction("kill", selectedTask()!.id)}>
                    <Icon name="warning" /> Force Kill
                  </Button>
                  <Button variant="secondary" onClick={() => runAction("restart", selectedTask()!.id)}>
                    <Icon name="refresh" /> Restart
                  </Button>
                </Show>
              </div>
            </div>

            <div class="grid grid-cols-2 md:grid-cols-4 gap-3 bg-background-strong p-3 rounded-lg border border-border-weaker text-xs">
              <div class="flex flex-col gap-0.5">
                <span class="text-text-weak font-medium">Command</span>
                <span class="font-mono truncate" title={selectedTask()!.command}>{selectedTask()!.command}</span>
              </div>
              <div class="flex flex-col gap-0.5">
                <span class="text-text-weak font-medium">Working Directory</span>
                <span class="font-mono truncate" title={selectedTask()!.cwd}>{selectedTask()!.cwd}</span>
              </div>
              <div class="flex flex-col gap-0.5">
                <span class="text-text-weak font-medium">PID</span>
                <span>{selectedTask()!.pid ?? "-"}</span>
              </div>
              <div class="flex flex-col gap-0.5">
                <span class="text-text-weak font-medium">Listening Port</span>
                <span>{selectedTask()!.port ?? "-"}</span>
              </div>
            </div>
          </div>

          {/* Console Header */}
          <div class="px-4 py-2 border-b border-border-weaker bg-background-strong flex items-center justify-between text-xs">
            <span class="font-bold text-text-weak uppercase tracking-wider">Console Output</span>
            <div class="flex items-center gap-4">
              <label class="flex items-center gap-1.5 cursor-pointer text-text-weak">
                <input
                  type="checkbox"
                  checked={autoScroll()}
                  onChange={(e) => setAutoScroll(e.currentTarget.checked)}
                />
                Auto-scroll
              </label>
              <Button size="small" variant="ghost" onClick={() => setLogText("")}>
                Clear Console
              </Button>
            </div>
          </div>

          {/* Console Output Pre */}
          <pre
            ref={logContainer}
            class="flex-1 bg-[#0b0c10] text-[#c5c6c7] p-4 font-mono text-xs overflow-y-auto leading-relaxed select-text shadow-inner"
            style={{ "white-space": "pre-wrap", "word-break": "break-all" }}
          >
            {logText()}
          </pre>
        </Show>
      </div>
    </div>
  )
}
