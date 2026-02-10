import { useSync } from "@tui/context/sync"
import { createMemo, createSignal, For, Show, Switch, Match } from "solid-js"
import { createStore } from "solid-js/store"
import { useTheme } from "../../context/theme"
import { Locale } from "@/util/locale"
import path from "path"
import type { AssistantMessage } from "@opencode-ai/sdk/v2"
import { Global } from "@/global"
import { Installation } from "@/installation"
import { useKeybind } from "../../context/keybind"
import { useDirectory } from "../../context/directory"
import { useKV } from "../../context/kv"
import { TodoItem } from "../../component/todo-item"
import { buildSessionTree, sessionRunState } from "../../lib/session-tree"
import { useRoute } from "../../context/route"

export function Sidebar(props: { sessionID: string; overlay?: boolean }) {
  const sync = useSync()
  const { theme } = useTheme()
  const route = useRoute()

  const [expanded, setExpanded] = createStore({
    mcp: true,
    diff: true,
    todo: true,
    lsp: true,
    subagents: true,
  })

  const tree = createMemo(() =>
    buildSessionTree({
      currentSessionID: props.sessionID,
      sessions: sync.data.session,
      sort: "created",
    }),
  )

  // 锚定到根会话：sidebar 始终显示根会话信息，hover 切换 subagent 时 sidebar 不会重绘
  const rootSessionID = createMemo(() => tree().rootID)
  const rootSession = createMemo(() => sync.session.get(rootSessionID())!)
  const isInSubagent = createMemo(() => props.sessionID !== rootSessionID())

  // 所有展示信息都基于根会话，保持 sidebar 稳定
  const diff = createMemo(() => sync.data.session_diff[rootSessionID()] ?? [])
  const todo = createMemo(() => sync.data.todo[rootSessionID()] ?? [])
  const messages = createMemo(() => sync.data.message[rootSessionID()] ?? [])

  const subagentSessions = createMemo(() => {
    const t = tree()
    const out: Array<{ session: (typeof sync.data.session)[number]; depth: number }> = []

    for (const item of t.list) {
      if (item.id === t.rootID) continue
      const s = t.sessionByID.get(item.id)
      if (!s) continue
      out.push({ session: s, depth: item.depth })
    }

    return out
  })

  const getSessionStatus = (sessionID: string) => {
    const status = sync.data.session_status?.[sessionID] as { type?: string } | undefined
    return sessionRunState(status)
  }

  // Parent 悬停状态
  const [parentHovered, setParentHovered] = createSignal(false)

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

  const hasProviders = createMemo(() =>
    sync.data.provider.some((x) => x.id !== "opencode" || Object.values(x.models).some((y) => y.cost?.input !== 0)),
  )
  const gettingStartedDismissed = createMemo(() => kv.get("dismissed_getting_started", false))

  return (
    <Show when={rootSession()}>
      <box
        backgroundColor={theme.backgroundPanel}
        width={42}
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
        position={props.overlay ? "absolute" : "relative"}
      >
        <scrollbox flexGrow={1}>
          <box flexShrink={0} gap={1} paddingRight={1}>
            <box paddingRight={1}>
              <text fg={theme.text}>
                <b>{rootSession().title}</b>
              </text>
              <Show when={rootSession().share?.url}>
                <text fg={theme.textMuted}>{rootSession().share!.url}</text>
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
            {/* Subagents Section */}
            <Show when={subagentSessions().length > 0}>
              <box>
                <box
                  flexDirection="row"
                  gap={1}
                  onMouseDown={() => setExpanded("subagents", !expanded.subagents)}
                >
                  <text fg={theme.text}>{expanded.subagents ? "▼" : "▶"}</text>
                  <text fg={theme.text}>
                    <b>Subagents</b>
                    <Show when={!expanded.subagents}>
                      <span style={{ fg: theme.textMuted }}> ({subagentSessions().length})</span>
                    </Show>
                  </text>
                </box>
                <Show when={expanded.subagents}>
                  {/* Parent 链接：始终显示，避免布局移位导致闪屏 */}
                  <box
                    flexDirection="row"
                    gap={1}
                    backgroundColor={parentHovered() && isInSubagent() ? theme.backgroundElement : undefined}
                    onMouseOver={() => {
                      setParentHovered(true)
                      if (isInSubagent()) {
                        route.navigate({ type: "session", sessionID: rootSessionID() })
                      }
                    }}
                    onMouseOut={() => setParentHovered(false)}
                    onMouseDown={() => {
                      if (isInSubagent()) {
                        route.navigate({ type: "session", sessionID: rootSessionID() })
                      }
                    }}
                  >
                    <text fg={!isInSubagent() ? theme.primary : theme.accent}>↑</text>
                    <text fg={!isInSubagent() ? theme.primary : parentHovered() ? theme.text : theme.text}>
                      {!isInSubagent() ? <span style={{ bold: true }}>Parent</span> : <b>Parent</b>}
                      <span style={{ fg: !isInSubagent() ? theme.primary : parentHovered() ? theme.text : theme.textMuted }}>
                        {" "}
                        {(() => {
                          const title = rootSession()?.title ?? "Primary"
                          return title.length > 25 ? title.slice(0, 25) + "…" : title
                        })()}
                      </span>
                    </text>
                  </box>
                  <For each={subagentSessions()}>
                    {(item) => {
                      const sub = item.session
                      const status = createMemo(() => getSessionStatus(sub.id))
                      const isCurrent = createMemo(() => sub.id === props.sessionID)
                      const [hovered, setHovered] = createSignal(false)
                      const statusColor = createMemo(() => {
                        if (status() === "working") return theme.warning
                        if (status() === "waiting") return theme.accent
                        return theme.success
                      })
                      const statusIcon = createMemo(() => {
                        if (status() === "working") return "◐"
                        if (status() === "waiting") return "◎"
                        return "•"
                      })
                      const label = createMemo(() => {
                        const indent = item.depth > 0 ? `${"  ".repeat(item.depth - 1)}↳ ` : ""
                        const title = sub.title ?? sub.id.slice(0, 16)
                        return indent + title
                      })
                      return (
                        <box
                          flexDirection="row"
                          gap={1}
                          backgroundColor={hovered() && !isCurrent() ? theme.backgroundElement : undefined}
                          onMouseOver={() => {
                            setHovered(true)
                            if (!isCurrent()) route.navigate({ type: "session", sessionID: sub.id })
                          }}
                          onMouseOut={() => setHovered(false)}
                          onMouseDown={() => !isCurrent() && route.navigate({ type: "session", sessionID: sub.id })}
                        >
                          <text flexShrink={0} fg={statusColor()}>
                            {statusIcon()}
                          </text>
                          <text fg={isCurrent() ? theme.primary : hovered() ? theme.text : theme.textMuted} wrapMode="word">
                            {isCurrent() || hovered() ? <span style={{ bold: true }}>{label()}</span> : label()}
                            {status() === "waiting" && <span style={{ fg: theme.accent }}> (waiting)</span>}
                          </text>
                        </box>
                      )
                    }}
                  </For>
                </Show>
              </box>
            </Show>
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
    </Show>
  )
}
