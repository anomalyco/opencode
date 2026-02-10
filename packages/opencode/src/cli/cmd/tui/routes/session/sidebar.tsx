import { useSync } from "@tui/context/sync"
import { createMemo, createSignal, For, Show, Switch, Match } from "solid-js"
import { createStore } from "solid-js/store"
import { useTheme } from "../../context/theme"
import { Locale } from "@/util/locale"
import path from "path"
import type { AssistantMessage, ToolPart } from "@opencode-ai/sdk/v2"
import { Global } from "@/global"
import { Installation } from "@/installation"
import { useTerminalDimensions } from "@opentui/solid"
import { useDirectory } from "../../context/directory"
import { useKV } from "../../context/kv"
import { useRoute } from "../../context/route"
import { TodoItem } from "../../component/todo-item"
import { Spinner } from "../../component/spinner"

export function Sidebar(props: { sessionID: string; overlay?: boolean }) {
  const sync = useSync()
  const { theme } = useTheme()
  const session = createMemo(() => sync.session.get(props.sessionID)!)
  const diff = createMemo(() => sync.data.session_diff[props.sessionID] ?? [])
  const todo = createMemo(() => sync.data.todo[props.sessionID] ?? [])
  const messages = createMemo(() => sync.data.message[props.sessionID] ?? [])

  const [expanded, setExpanded] = createStore({
    mcp: true,
    diff: true,
    todo: true,
    lsp: true,
    team: true,
  })

  // Sort MCP servers alphabetically for consistent display order
  const mcpEntries = createMemo(() => Object.entries(sync.data.mcp).sort(([a], [b]) => a.localeCompare(b)))

  // Count connected and error MCP servers for collapsed header display
  const connectedMcpCount = createMemo(() => mcpEntries().filter(([_, item]) => item.status === "connected").length)
  const errorMcpCount = createMemo(
    () =>
      mcpEntries().filter(
        ([_, item]) =>
          item.status === "failed" || item.status === "needs_auth" || item.status === "needs_client_registration",
      ).length,
  )

  const cost = createMemo(() => {
    const total = messages().reduce((sum, x) => sum + (x.role === "assistant" ? x.cost : 0), 0)
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(total)
  })

  const context = createMemo(() => {
    const last = messages().findLast((x) => x.role === "assistant" && x.tokens.output > 0) as AssistantMessage
    if (!last) return
    const total =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    const model = sync.data.provider.find((x) => x.id === last.providerID)?.models[last.modelID]
    return {
      tokens: total.toLocaleString(),
      percentage: model?.limit.context ? Math.round((total / model.limit.context) * 100) : null,
    }
  })

  const directory = useDirectory()
  const kv = useKV()
  const teamInfo = createMemo(() => sync.data.team[props.sessionID])
  const teamMembers = createMemo(
    () =>
      (teamInfo()?.members ?? []) as Array<{
        name: string
        sessionID: string
        agent: string
        status: string
        model?: string
        planApproval?: string
      }>,
  )
  const teamTasks = createMemo(
    () =>
      (teamInfo()?.tasks ?? []) as Array<{
        id: string
        content: string
        status: string
        priority: string
        assignee?: string
        depends_on?: string[]
      }>,
  )

  const hasProviders = createMemo(() =>
    sync.data.provider.some((x) => x.id !== "opencode" || Object.values(x.models).some((y) => y.cost?.input !== 0)),
  )
  const gettingStartedDismissed = createMemo(() => kv.get("dismissed_getting_started", false))
  const dimensions = useTerminalDimensions()
  const [dragging, setDragging] = createSignal(false)
  const dragStart = { x: 0, width: 42 }
  const MIN_WIDTH = 32
  const width = createMemo(() => {
    const max = Math.floor(dimensions().width * 0.75)
    return Math.max(MIN_WIDTH, Math.min(max, kv.get("sidebar_width", 42) as number))
  })

  return (
    <Show when={session()}>
      <box
        flexDirection="row"
        width={width()}
        height="100%"
        flexShrink={0}
        position={props.overlay ? "absolute" : "relative"}
      >
        <box
          width={1}
          height="100%"
          backgroundColor={dragging() ? theme.primary : theme.border}
          onMouseDown={(e: any) => {
            setDragging(true)
            dragStart.x = e.x
            dragStart.width = width()
          }}
          onMouseDrag={(e: any) => {
            const delta = dragStart.x - e.x
            const max = Math.floor(dimensions().width * 0.75)
            const next = Math.max(MIN_WIDTH, Math.min(max, dragStart.width + delta))
            kv.set("sidebar_width", next)
          }}
          onMouseDragEnd={() => setDragging(false)}
          onMouseUp={() => setDragging(false)}
          flexShrink={0}
        />
        <box
          backgroundColor={theme.backgroundPanel}
          width={width() - 2}
          height="100%"
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={2}
          paddingRight={1}
          flexShrink={0}
          overflow="hidden"
        >
          <scrollbox flexGrow={1}>
            <box flexShrink={0} gap={1} paddingRight={1}>
              <box paddingRight={1}>
                <text fg={theme.text}>
                  <b>{session().title}</b>
                </text>
                <Show when={session().share?.url}>
                  <text fg={theme.textMuted}>{session().share!.url}</text>
                </Show>
              </box>
              <box>
                <text fg={theme.text}>
                  <b>Context</b>
                </text>
                <text fg={theme.textMuted}>{context()?.tokens ?? 0} tokens</text>
                <text fg={theme.textMuted}>{context()?.percentage ?? 0}% used</text>
                <text fg={theme.textMuted}>{cost()} spent</text>
              </box>
              <Show when={mcpEntries().length > 0}>
                <box>
                  <box
                    flexDirection="row"
                    gap={1}
                    onMouseDown={() => mcpEntries().length > 2 && setExpanded("mcp", !expanded.mcp)}
                  >
                    <Show when={mcpEntries().length > 2}>
                      <text fg={theme.text}>{expanded.mcp ? "▼" : "▶"}</text>
                    </Show>
                    <text fg={theme.text}>
                      <b>MCP</b>
                      <Show when={!expanded.mcp}>
                        <span style={{ fg: theme.textMuted }}>
                          {" "}
                          ({connectedMcpCount()} active
                          {errorMcpCount() > 0 ? `, ${errorMcpCount()} error${errorMcpCount() > 1 ? "s" : ""}` : ""})
                        </span>
                      </Show>
                    </text>
                  </box>
                  <Show when={mcpEntries().length <= 2 || expanded.mcp}>
                    <For each={mcpEntries()}>
                      {([key, item]) => (
                        <box flexDirection="row" gap={1}>
                          <text
                            flexShrink={0}
                            style={{
                              fg: (
                                {
                                  connected: theme.success,
                                  failed: theme.error,
                                  disabled: theme.textMuted,
                                  needs_auth: theme.warning,
                                  needs_client_registration: theme.error,
                                } as Record<string, typeof theme.success>
                              )[item.status],
                            }}
                          >
                            •
                          </text>
                          <text fg={theme.text} wrapMode="word">
                            {key}{" "}
                            <span style={{ fg: theme.textMuted }}>
                              <Switch fallback={item.status}>
                                <Match when={item.status === "connected"}>Connected</Match>
                                <Match when={item.status === "failed" && item}>{(val) => <i>{val().error}</i>}</Match>
                                <Match when={item.status === "disabled"}>Disabled</Match>
                                <Match when={(item.status as string) === "needs_auth"}>Needs auth</Match>
                                <Match when={(item.status as string) === "needs_client_registration"}>
                                  Needs client ID
                                </Match>
                              </Switch>
                            </span>
                          </text>
                        </box>
                      )}
                    </For>
                  </Show>
                </box>
              </Show>
              <box>
                <box
                  flexDirection="row"
                  gap={1}
                  onMouseDown={() => sync.data.lsp.length > 2 && setExpanded("lsp", !expanded.lsp)}
                >
                  <Show when={sync.data.lsp.length > 2}>
                    <text fg={theme.text}>{expanded.lsp ? "▼" : "▶"}</text>
                  </Show>
                  <text fg={theme.text}>
                    <b>LSP</b>
                  </text>
                </box>
                <Show when={sync.data.lsp.length <= 2 || expanded.lsp}>
                  <Show when={sync.data.lsp.length === 0}>
                    <text fg={theme.textMuted}>
                      {sync.data.config.lsp === false
                        ? "LSPs have been disabled in settings"
                        : "LSPs will activate as files are read"}
                    </text>
                  </Show>
                  <For each={sync.data.lsp}>
                    {(item) => (
                      <box flexDirection="row" gap={1}>
                        <text
                          flexShrink={0}
                          style={{
                            fg: {
                              connected: theme.success,
                              error: theme.error,
                            }[item.status],
                          }}
                        >
                          •
                        </text>
                        <text fg={theme.textMuted}>
                          {item.id} {item.root}
                        </text>
                      </box>
                    )}
                  </For>
                </Show>
              </box>
              <Show when={todo().length > 0 && todo().some((t) => t.status !== "completed")}>
                <box>
                  <box
                    flexDirection="row"
                    gap={1}
                    onMouseDown={() => todo().length > 2 && setExpanded("todo", !expanded.todo)}
                  >
                    <Show when={todo().length > 2}>
                      <text fg={theme.text}>{expanded.todo ? "▼" : "▶"}</text>
                    </Show>
                    <text fg={theme.text}>
                      <b>Todo</b>
                    </text>
                  </box>
                  <Show when={todo().length <= 2 || expanded.todo}>
                    <For each={todo()}>{(todo) => <TodoItem status={todo.status} content={todo.content} />}</For>
                  </Show>
                </box>
              </Show>
              <Show when={teamInfo()}>
                <Show when={(teamInfo() as any)?.role === "member"}>
                  <TeamMemberSidebar teamInfo={teamInfo()} sessionID={props.sessionID} teamTasks={teamTasks()} />
                </Show>
                <Show when={(teamInfo() as any)?.role !== "member" && teamMembers().length > 0}>
                  <TeamLeadSidebar teamInfo={teamInfo()} teamMembers={teamMembers()} teamTasks={teamTasks()} />
                </Show>
              </Show>
              <Show when={diff().length > 0}>
                <box>
                  <box
                    flexDirection="row"
                    gap={1}
                    onMouseDown={() => diff().length > 2 && setExpanded("diff", !expanded.diff)}
                  >
                    <Show when={diff().length > 2}>
                      <text fg={theme.text}>{expanded.diff ? "▼" : "▶"}</text>
                    </Show>
                    <text fg={theme.text}>
                      <b>Modified Files</b>
                    </text>
                  </box>
                  <Show when={diff().length <= 2 || expanded.diff}>
                    <For each={diff() || []}>
                      {(item) => {
                        return (
                          <box flexDirection="row" gap={1} justifyContent="space-between">
                            <text fg={theme.textMuted} wrapMode="none">
                              {item.file}
                            </text>
                            <box flexDirection="row" gap={1} flexShrink={0}>
                              <Show when={item.additions}>
                                <text fg={theme.diffAdded}>+{item.additions}</text>
                              </Show>
                              <Show when={item.deletions}>
                                <text fg={theme.diffRemoved}>-{item.deletions}</text>
                              </Show>
                            </box>
                          </box>
                        )
                      }}
                    </For>
                  </Show>
                </box>
              </Show>
            </box>
          </scrollbox>

          <box flexShrink={0} gap={1} paddingTop={1}>
            <Show when={!hasProviders() && !gettingStartedDismissed()}>
              <box
                backgroundColor={theme.backgroundElement}
                paddingTop={1}
                paddingBottom={1}
                paddingLeft={2}
                paddingRight={2}
                flexDirection="row"
                gap={1}
              >
                <text flexShrink={0} fg={theme.text}>
                  ⬖
                </text>
                <box flexGrow={1} gap={1}>
                  <box flexDirection="row" justifyContent="space-between">
                    <text fg={theme.text}>
                      <b>Getting started</b>
                    </text>
                    <text fg={theme.textMuted} onMouseDown={() => kv.set("dismissed_getting_started", true)}>
                      ✕
                    </text>
                  </box>
                  <text fg={theme.textMuted}>OpenCode includes free models so you can start immediately.</text>
                  <text fg={theme.textMuted}>
                    Connect from 75+ providers to use other models, including Claude, GPT, Gemini etc
                  </text>
                  <box flexDirection="row" gap={1} justifyContent="space-between">
                    <text fg={theme.text}>Connect provider</text>
                    <text fg={theme.textMuted}>/connect</text>
                  </box>
                </box>
              </box>
            </Show>
            <text>
              <span style={{ fg: theme.textMuted }}>{directory().split("/").slice(0, -1).join("/")}/</span>
              <span style={{ fg: theme.text }}>{directory().split("/").at(-1)}</span>
            </text>
            <text fg={theme.textMuted}>
              <span style={{ fg: theme.success }}>•</span> <b>Open</b>
              <span style={{ fg: theme.text }}>
                <b>Code</b>
              </span>{" "}
              <span>{Installation.VERSION}</span>
            </text>
          </box>
        </box>
        <box width={1} height="100%" backgroundColor={theme.backgroundPanel} flexShrink={0} />
      </box>
    </Show>
  )
}

function memberColor(status: string, theme: any) {
  switch (status) {
    case "busy":
      return theme.success
    case "shutdown_requested":
      return theme.warning
    case "error":
      return theme.error
    case "shutdown":
      return theme.error
    default:
      return theme.textMuted
  }
}

/** Lead's team sidebar — compact overview with truncated per-member todos */
function TeamLeadSidebar(props: {
  teamInfo: any
  teamMembers: Array<{ name: string; sessionID: string; agent: string; status: string; model?: string }>
  teamTasks: Array<{
    id: string
    content: string
    status: string
    priority: string
    assignee?: string
    depends_on?: string[]
  }>
}) {
  const sync = useSync()
  const { theme } = useTheme()
  const nav = useRoute()
  const [expanded, setExpanded] = createSignal(true)

  return (
    <box>
      <box flexDirection="row" gap={1} onMouseDown={() => setExpanded(!expanded())}>
        <text fg={theme.text}>{expanded() ? "▼" : "▶"}</text>
        <text fg={theme.text}>
          <b>Team</b>
          <Show when={!expanded()}>
            <span style={{ fg: theme.textMuted }}>
              {" "}
              ({props.teamMembers.filter((m) => m.status === "busy").length} active, {props.teamMembers.length} total)
            </span>
          </Show>
        </text>
      </box>
      <Show when={expanded()}>
        <For each={props.teamMembers}>
          {(member) => {
            const todos = createMemo(() =>
              (sync.data.todo[member.sessionID] ?? []).filter((t: any) => t.status !== "completed"),
            )
            const visible = createMemo(() => todos().slice(0, 2))
            const remaining = createMemo(() => Math.max(0, todos().length - 2))
            return (
              <box
                flexDirection="column"
                onMouseUp={() => {
                  if (member.sessionID) nav.navigate({ type: "session", sessionID: member.sessionID })
                }}
              >
                <box flexDirection="row" gap={1}>
                  <text flexShrink={0} fg={memberColor(member.status, theme)}>
                    •
                  </text>
                  <text fg={theme.text} wrapMode="word">
                    {member.name}
                    <span style={{ fg: theme.textMuted }}> ({member.agent})</span>
                  </text>
                </box>
                <Show when={member.status === "busy"}>
                  <TeammateActivity sessionID={member.sessionID} />
                </Show>
                <Show when={visible().length > 0}>
                  <box paddingLeft={2}>
                    <For each={visible()}>{(t: any) => <TodoItem status={t.status} content={t.content} />}</For>
                    <Show when={remaining() > 0}>
                      <text fg={theme.textMuted}>+{remaining()} more</text>
                    </Show>
                  </box>
                </Show>
              </box>
            )
          }}
        </For>
        <Show when={props.teamTasks.length > 0}>
          <For each={props.teamTasks}>
            {(task) => {
              const assignee = createMemo(() =>
                task.assignee ? props.teamMembers.find((m) => m.name === task.assignee) : undefined,
              )
              return (
                <box
                  flexDirection="column"
                  onMouseUp={() => {
                    const a = assignee()
                    if (a?.sessionID) nav.navigate({ type: "session", sessionID: a.sessionID })
                  }}
                >
                  <box flexDirection="row" gap={1}>
                    <text fg={teamTaskColor(task.status, theme)} flexShrink={0} wrapMode="none">
                      {teamTaskIcon(task.status)}
                    </text>
                    <text fg={task.status === "in_progress" ? theme.text : theme.textMuted} wrapMode="word">
                      {task.content}
                    </text>
                  </box>
                  <Show when={task.assignee}>
                    <text fg={theme.primary} paddingLeft={2} wrapMode="none">
                      @{task.assignee}
                    </text>
                  </Show>
                  <Show when={task.depends_on && task.depends_on.length > 0 && task.status === "blocked"}>
                    <text fg={theme.textMuted} paddingLeft={2} wrapMode="none">
                      blocked by {task.depends_on!.map((d) => `#${d}`).join(", ")}
                    </text>
                  </Show>
                  <Show when={task.status === "in_progress" && assignee()?.status === "busy"}>
                    <TeammateActivity sessionID={assignee()!.sessionID} />
                  </Show>
                </box>
              )
            }}
          </For>
          <text fg={theme.textMuted}>
            {props.teamTasks.filter((t) => t.status === "completed").length}/{props.teamTasks.length} completed
          </text>
        </Show>
      </Show>
    </box>
  )
}

/** Teammate's team sidebar — full detail for this member, compact view of others */
function TeamMemberSidebar(props: {
  teamInfo: any
  sessionID: string
  teamTasks: Array<{
    id: string
    content: string
    status: string
    priority: string
    assignee?: string
    depends_on?: string[]
  }>
}) {
  const sync = useSync()
  const { theme } = useTheme()
  const nav = useRoute()
  const [expanded, setExpanded] = createSignal(true)

  const info = () =>
    props.teamInfo as { teamName: string; role: string; memberName: string; members: any[]; tasks: any[] }
  const members = createMemo(
    () => (info().members ?? []) as Array<{ name: string; sessionID: string; agent: string; status: string }>,
  )
  const todos = createMemo(() => (sync.data.todo[props.sessionID] ?? []).filter((t: any) => t.status !== "completed"))
  const completedCount = createMemo(
    () => (sync.data.todo[props.sessionID] ?? []).filter((t: any) => t.status === "completed").length,
  )
  const totalCount = createMemo(() => (sync.data.todo[props.sessionID] ?? []).length)

  return (
    <box>
      <box flexDirection="row" gap={1} onMouseDown={() => setExpanded(!expanded())}>
        <text fg={theme.text}>{expanded() ? "▼" : "▶"}</text>
        <text fg={theme.text}>
          <b>Team: {info().teamName}</b>
        </text>
      </box>
      <Show when={expanded()}>
        <text fg={theme.textMuted}>Role: member ({info().memberName})</text>
        {/* Full individual todo list */}
        <Show when={todos().length > 0}>
          <box paddingTop={1}>
            <text fg={theme.text}>
              <b>My Tasks</b>
            </text>
            <For each={todos()}>{(t: any) => <TodoItem status={t.status} content={t.content} />}</For>
            <Show when={totalCount() > 0}>
              <text fg={theme.textMuted}>
                {completedCount()}/{totalCount()} completed
              </text>
            </Show>
          </box>
        </Show>
        {/* Compact teammate list */}
        <Show when={members().length > 0}>
          <box paddingTop={1}>
            <text fg={theme.text}>
              <b>Teammates</b>
            </text>
            <For each={members()}>
              {(member) => (
                <box
                  flexDirection="row"
                  gap={1}
                  onMouseUp={() => {
                    if (member.sessionID) nav.navigate({ type: "session", sessionID: member.sessionID })
                  }}
                >
                  <text flexShrink={0} fg={memberColor(member.status, theme)}>
                    •
                  </text>
                  <text fg={member.name === info().memberName ? theme.primary : theme.text} wrapMode="word">
                    {member.name}
                    <Show when={member.name === info().memberName}>
                      <span style={{ fg: theme.textMuted }}> (you)</span>
                    </Show>
                    <span style={{ fg: theme.textMuted }}> — {member.status}</span>
                  </text>
                </box>
              )}
            </For>
          </box>
        </Show>
        {/* Shared task list */}
        <Show when={props.teamTasks.length > 0}>
          <box paddingTop={1}>
            <text fg={theme.text}>
              <b>Shared Tasks</b>
            </text>
            <For each={props.teamTasks}>
              {(task) => (
                <box flexDirection="row" gap={1}>
                  <text fg={teamTaskColor(task.status, theme)} flexShrink={0} wrapMode="none">
                    {teamTaskIcon(task.status)}
                  </text>
                  <text fg={task.status === "in_progress" ? theme.text : theme.textMuted} wrapMode="word">
                    {task.content}
                    <Show when={task.assignee}>
                      <span style={{ fg: theme.primary }}> @{task.assignee}</span>
                    </Show>
                  </text>
                </box>
              )}
            </For>
            <text fg={theme.textMuted}>
              {props.teamTasks.filter((t) => t.status === "completed").length}/{props.teamTasks.length} completed
            </text>
          </box>
        </Show>
      </Show>
    </box>
  )
}

function teamTaskIcon(status: string): string {
  switch (status) {
    case "completed":
      return "+"
    case "in_progress":
      return "■"
    case "blocked":
      return "□"
    case "cancelled":
      return "x"
    default:
      return "□"
  }
}

function teamTaskColor(status: string, theme: any) {
  switch (status) {
    case "completed":
      return theme.success
    case "in_progress":
      return theme.warning
    case "blocked":
      return theme.textMuted
    case "cancelled":
      return theme.error
    default:
      return theme.textMuted
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max - 1) + "…"
}

function formatToolActivity(tp: ToolPart): string {
  const name = tp.tool
  const state = tp.state
  if (state.status === "running") {
    if (state.title) return `${name}: ${state.title}`
    const input = state.input as Record<string, any>
    if (name === "bash" && input.command) return truncate(`$ ${input.command}`, 36)
    if (name === "read" && input.filePath) return `Read ${truncate(input.filePath, 30)}`
    if (name === "grep" && input.pattern) return `Grep "${truncate(input.pattern, 28)}"`
    if (name === "glob" && input.pattern) return `Glob "${truncate(input.pattern, 28)}"`
    if (name === "write" && input.filePath) return `Write ${truncate(input.filePath, 30)}`
    if (name === "edit" && input.filePath) return `Edit ${truncate(input.filePath, 30)}`
    if ((name === "webfetch" || name === "mcp_webfetch") && input.url) return `Fetch ${truncate(input.url, 30)}`
    if (name === "web_search" && input.query) return `Search "${truncate(input.query, 26)}"`
    if (name === "team_message") return `Msg @${input.to ?? "..."}`
    if (name === "team_tasks") return "Checking tasks"
    return `${name}...`
  }
  if (state.status === "completed") {
    if (state.title) return truncate(`${name}: ${state.title}`, 36)
    return `${name} done`
  }
  if (state.status === "error") return `${name} error`
  return `${name}...`
}

/** Shows the current tool activity for a teammate session */
function TeammateActivity(props: { sessionID: string }) {
  const sync = useSync()
  const { theme } = useTheme()

  const activity = createMemo(() => {
    const msgs = sync.data.message[props.sessionID] ?? []
    for (let i = msgs.length - 1; i >= 0; i--) {
      const msg = msgs[i]
      if (msg.role !== "assistant") continue
      const parts = sync.data.part[msg.id] ?? []
      for (let j = parts.length - 1; j >= 0; j--) {
        const part = parts[j]
        if (part.type !== "tool") continue
        const tp = part as ToolPart
        if (tp.state.status === "pending") continue
        return tp
      }
    }
    return undefined
  })

  return (
    <Show when={activity()}>
      {(tp) => (
        <box paddingLeft={2}>
          <Show
            when={tp().state.status === "running"}
            fallback={
              <text fg={theme.textMuted} wrapMode="none">
                {formatToolActivity(tp())}
              </text>
            }
          >
            <Spinner color={theme.textMuted}>{formatToolActivity(tp())}</Spinner>
          </Show>
        </box>
      )}
    </Show>
  )
}
