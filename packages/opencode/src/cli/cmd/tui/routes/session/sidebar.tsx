import { useSync } from "@tui/context/sync"
import { createMemo, For, Show, Switch, Match } from "solid-js"
import { createStore } from "solid-js/store"
import { useTheme } from "../../context/theme"
import type { AssistantMessage } from "@opencode-ai/sdk/v2"
import { Installation } from "@/installation"
import { useDirectory } from "../../context/directory"
import { useKV } from "../../context/kv"
import { TodoItem } from "../../component/todo-item"
import { TuiPluginRuntime } from "../../plugin"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

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
  })

  const mcp = createMemo(() =>
    Object.entries(sync.data.mcp)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, item]) => ({
        name,
        status: item.status,
        error: item.status === "failed" ? item.error : undefined,
      })),
  )

  const lsp = createMemo(() => sync.data.lsp.map((item) => ({ id: item.id, root: item.root, status: item.status })))

  const connectedMcpCount = createMemo(() => mcp().filter((item) => item.status === "connected").length)
  const errorMcpCount = createMemo(
    () =>
      mcp().filter(
        (item) =>
          item.status === "failed" || item.status === "needs_auth" || item.status === "needs_client_registration",
      ).length,
  )

  const cost = createMemo(() => messages().reduce((sum, x) => sum + (x.role === "assistant" ? x.cost : 0), 0))
  const mcpStatusColor: Record<string, typeof theme.success> = {
    connected: theme.success,
    failed: theme.error,
    disabled: theme.textMuted,
    needs_auth: theme.warning,
    needs_client_registration: theme.error,
  }

  const context = createMemo(() => {
    const last = messages().findLast((x): x is AssistantMessage => x.role === "assistant" && x.tokens.output > 0)
    if (!last) return { tokens: 0, percentage: null }
    const tokens =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    const model = sync.data.provider.find((x) => x.id === last.providerID)?.models[last.modelID]
    return {
      tokens,
      percentage: model?.limit.context ? Math.round((tokens / model.limit.context) * 100) : null,
    }
  })

  const directory = useDirectory()
  const kv = useKV()

  const hasProviders = createMemo(() =>
    sync.data.provider.some((x) => x.id !== "opencode" || Object.values(x.models).some((y) => y.cost?.input !== 0)),
  )
  const gettingStartedDismissed = createMemo(() => kv.get("dismissed_getting_started", false))
  const showGettingStarted = createMemo(() => !hasProviders() && !gettingStartedDismissed())
  const dir = createMemo(() => {
    const value = directory()
    const parts = value.split("/")
    return {
      value,
      parent: parts.slice(0, -1).join("/"),
      name: parts.at(-1) ?? "",
    }
  })

  return (
    <Show when={session()}>
      <box
        backgroundColor={theme.backgroundPanel}
        width={42}
        height="100%"
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
        position={props.overlay ? "absolute" : "relative"}
      >
        <scrollbox
          flexGrow={1}
          verticalScrollbarOptions={{
            trackOptions: {
              backgroundColor: theme.background,
              foregroundColor: theme.borderActive,
            },
          }}
        >
          <box flexShrink={0} gap={1} paddingRight={1}>
            <TuiPluginRuntime.Slot name="sidebar_top" session_id={props.sessionID} />
            <TuiPluginRuntime.Slot
              name="sidebar_title"
              mode="replace"
              session_id={props.sessionID}
              title={session().title}
              share_url={session().share?.url}
            >
              <box paddingRight={1}>
                <text fg={theme.text}>
                  <b>{session().title}</b>
                </text>
                <Show when={session().share?.url}>
                  <text fg={theme.textMuted}>{session().share!.url}</text>
                </Show>
              </box>
            </TuiPluginRuntime.Slot>
            <TuiPluginRuntime.Slot
              name="sidebar_context"
              mode="replace"
              session_id={props.sessionID}
              tokens={context().tokens}
              percentage={context().percentage}
              cost={cost()}
            >
              <box>
                <text fg={theme.text}>
                  <b>Context</b>
                </text>
                <text fg={theme.textMuted}>{context().tokens.toLocaleString()} tokens</text>
                <text fg={theme.textMuted}>{context().percentage ?? 0}% used</text>
                <text fg={theme.textMuted}>{money.format(cost())} spent</text>
              </box>
            </TuiPluginRuntime.Slot>
            <TuiPluginRuntime.Slot
              name="sidebar_mcp"
              mode="replace"
              session_id={props.sessionID}
              items={mcp()}
              connected={connectedMcpCount()}
              errors={errorMcpCount()}
            >
              <Show when={mcp().length > 0}>
                <box>
                  <box
                    flexDirection="row"
                    gap={1}
                    onMouseDown={() => mcp().length > 2 && setExpanded("mcp", !expanded.mcp)}
                  >
                    <Show when={mcp().length > 2}>
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
                  <Show when={mcp().length <= 2 || expanded.mcp}>
                    <For each={mcp()}>
                      {(item) => (
                        <box flexDirection="row" gap={1}>
                          <text
                            flexShrink={0}
                            style={{
                              fg: mcpStatusColor[item.status],
                            }}
                          >
                            •
                          </text>
                          <text fg={theme.text} wrapMode="word">
                            {item.name}{" "}
                            <span style={{ fg: theme.textMuted }}>
                              <Switch fallback={item.status}>
                                <Match when={item.status === "connected"}>Connected</Match>
                                <Match when={item.status === "failed"}>
                                  <i>{item.error}</i>
                                </Match>
                                <Match when={item.status === "disabled"}>Disabled</Match>
                                <Match when={item.status === "needs_auth"}>Needs auth</Match>
                                <Match when={item.status === "needs_client_registration"}>Needs client ID</Match>
                              </Switch>
                            </span>
                          </text>
                        </box>
                      )}
                    </For>
                  </Show>
                </box>
              </Show>
            </TuiPluginRuntime.Slot>
            <TuiPluginRuntime.Slot
              name="sidebar_lsp"
              mode="replace"
              session_id={props.sessionID}
              items={lsp()}
              disabled={sync.data.config.lsp === false}
            >
              <box>
                <box
                  flexDirection="row"
                  gap={1}
                  onMouseDown={() => lsp().length > 2 && setExpanded("lsp", !expanded.lsp)}
                >
                  <Show when={lsp().length > 2}>
                    <text fg={theme.text}>{expanded.lsp ? "▼" : "▶"}</text>
                  </Show>
                  <text fg={theme.text}>
                    <b>LSP</b>
                  </text>
                </box>
                <Show when={lsp().length <= 2 || expanded.lsp}>
                  <Show when={lsp().length === 0}>
                    <text fg={theme.textMuted}>
                      {sync.data.config.lsp === false
                        ? "LSPs have been disabled in settings"
                        : "LSPs will activate as files are read"}
                    </text>
                  </Show>
                  <For each={lsp()}>
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
            </TuiPluginRuntime.Slot>
            <TuiPluginRuntime.Slot name="sidebar_todo" mode="replace" session_id={props.sessionID} items={todo()}>
              <Show when={todo().length > 0 && todo().some((item) => item.status !== "completed")}>
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
                    <For each={todo()}>{(item) => <TodoItem status={item.status} content={item.content} />}</For>
                  </Show>
                </box>
              </Show>
            </TuiPluginRuntime.Slot>
            <TuiPluginRuntime.Slot name="sidebar_files" mode="replace" session_id={props.sessionID} items={diff()}>
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
                    <For each={diff()}>
                      {(item) => (
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
                      )}
                    </For>
                  </Show>
                </box>
              </Show>
            </TuiPluginRuntime.Slot>
          </box>
        </scrollbox>

        <box flexShrink={0} gap={1} paddingTop={1}>
          <TuiPluginRuntime.Slot
            name="sidebar_getting_started"
            mode="replace"
            session_id={props.sessionID}
            show_getting_started={showGettingStarted()}
            has_providers={hasProviders()}
            dismissed={gettingStartedDismissed()}
          >
            <Show when={showGettingStarted()}>
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
          </TuiPluginRuntime.Slot>
          <TuiPluginRuntime.Slot
            name="sidebar_directory"
            mode="replace"
            session_id={props.sessionID}
            directory={dir().value}
            directory_parent={dir().parent}
            directory_name={dir().name}
          >
            <text>
              <span style={{ fg: theme.textMuted }}>{dir().parent}/</span>
              <span style={{ fg: theme.text }}>{dir().name}</span>
            </text>
          </TuiPluginRuntime.Slot>
          <TuiPluginRuntime.Slot
            name="sidebar_version"
            mode="replace"
            session_id={props.sessionID}
            version={Installation.VERSION}
          >
            <text fg={theme.textMuted}>
              <span style={{ fg: theme.success }}>•</span> <b>Open</b>
              <span style={{ fg: theme.text }}>
                <b>Code</b>
              </span>{" "}
              <span>{Installation.VERSION}</span>
            </text>
          </TuiPluginRuntime.Slot>
          <TuiPluginRuntime.Slot
            name="sidebar_bottom"
            session_id={props.sessionID}
            directory={dir().value}
            directory_parent={dir().parent}
            directory_name={dir().name}
            version={Installation.VERSION}
            show_getting_started={showGettingStarted()}
            has_providers={hasProviders()}
            dismissed={gettingStartedDismissed()}
          />
        </box>
      </box>
    </Show>
  )
}
