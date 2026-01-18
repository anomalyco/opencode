import { useSync } from "@tui/context/sync"
import { createMemo, createSignal, createEffect, For, Show, Switch, Match } from "solid-js"
import { createStore } from "solid-js/store"
import { Usage, type ProviderUsage, type RateWindow } from "@/usage"
import { useTheme } from "../../context/theme"
import { Locale } from "@/util/locale"
import path from "path"
import type { AssistantMessage } from "@opencode-ai/sdk/v2"
import { Global } from "@/global"
import { Installation } from "@/installation"
import { useKeybind } from "../../context/keybind"
import { useDirectory } from "../../context/directory"
import { useKV } from "../../context/kv"
import { useLocal } from "../../context/local"
import { TodoItem } from "../../component/todo-item"

// Map OpenCode provider IDs to usage provider IDs
const PROVIDER_MAP: Record<string, string> = {
  "github-copilot": "github-copilot",
  "github-copilot-enterprise": "github-copilot",
  openai: "openai",
  anthropic: "anthropic",
  google: "antigravity",
  "google-vertex": "antigravity",
  opencode: "opencode",
}

// Providers that are pay-per-use with no rate limits
const UNLIMITED_PROVIDERS: Record<string, string> = {
  opencode: "OpenCode Zen",
}

export function Sidebar(props: { sessionID: string; overlay?: boolean }) {
  const sync = useSync()
  const { theme } = useTheme()
  const local = useLocal()
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

  // Usage tracking
  const [usageProviders, setUsageProviders] = createSignal<ProviderUsage[]>([])
  const [usageLoading, setUsageLoading] = createSignal(true)

  // Get current provider from the selected model (not last assistant message)
  const currentProviderID = createMemo(() => {
    const model = local.model.current()
    if (!model) return null
    return PROVIDER_MAP[model.providerID] ?? model.providerID
  })

  const currentUsage = createMemo((): ProviderUsage | null => {
    const id = currentProviderID()
    if (!id) return null

    // If it's an unlimited provider, create a synthetic entry
    if (UNLIMITED_PROVIDERS[id]) {
      return {
        providerId: id,
        providerLabel: UNLIMITED_PROVIDERS[id],
        status: "unlimited",
      }
    }

    // Return usage data for this provider (including error states)
    const found = usageProviders().find((p) => p.providerId === id)
    return found ?? null
  })

  const fetchUsage = async () => {
    const providerID = currentProviderID()
    if (!providerID) {
      setUsageProviders([])
      setUsageLoading(false)
      return
    }

    if (usageHidden()) return

    if (UNLIMITED_PROVIDERS[providerID]) {
      setUsageProviders([])
      setUsageLoading(false)
      return
    }

    setUsageLoading(true)
    try {
      const snapshot = await Usage.fetch({ providers: [providerID] })
      setUsageProviders(snapshot.providers)
    } catch {
      // Silently fail - usage section will just not show
    } finally {
      setUsageLoading(false)
    }
  }

  // Refetch usage when an assistant turn completes
  // Track the last completed assistant message ID
  const lastCompletedAssistantId = createMemo(() => {
    const assistantMsgs = messages().filter((x) => x.role === "assistant" && x.time.completed)
    if (assistantMsgs.length === 0) return null
    return assistantMsgs[assistantMsgs.length - 1]?.id
  })

  let prevCompletedId: string | null = null
  createEffect(() => {
    const currentId = lastCompletedAssistantId()
    if (currentId && currentId !== prevCompletedId) {
      prevCompletedId = currentId
      // Debounce slightly to avoid rapid refetches
      setTimeout(fetchUsage, 100)
    }
  })

  // Refetch usage when the selected provider changes
  let prevProviderID: string | null = null
  createEffect(() => {
    const providerID = currentProviderID()
    if (!providerID) {
      prevProviderID = null
      setUsageProviders([])
      setUsageLoading(false)
      return
    }
    if (providerID !== prevProviderID) {
      prevProviderID = providerID
      fetchUsage()
    }
  })

  // Refetch usage when the section is shown again
  let prevHidden: boolean | null = null
  createEffect(() => {
    const hidden = usageHidden()
    if (prevHidden === null) {
      prevHidden = hidden
      return
    }
    if (prevHidden && !hidden) {
      fetchUsage()
    }
    prevHidden = hidden
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

  const hasProviders = createMemo(() =>
    sync.data.provider.some((x) => x.id !== "opencode" || Object.values(x.models).some((y) => y.cost?.input !== 0)),
  )
  const gettingStartedDismissed = createMemo(() => kv.get("dismissed_getting_started", false))
  const usageHidden = createMemo(() => kv.get("hidden_sidebar_usage", false))

  return (
    <Show when={session()}>
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
              <Show when={usageHidden()}>
                <text fg={theme.textMuted} onMouseDown={() => kv.set("hidden_sidebar_usage", false)}>
                  <u>Show usage</u>
                </text>
              </Show>
            </box>
            <Show when={!usageLoading() && currentUsage() && !usageHidden()}>
              <SidebarUsageSection usage={currentUsage()!} onHide={() => kv.set("hidden_sidebar_usage", true)} />
            </Show>
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

function SidebarUsageSection(props: { usage: ProviderUsage; onHide: () => void }) {
  const { theme } = useTheme()
  const u = () => props.usage

  // Compact progress bar for sidebar (narrower than dialog)
  const barWidth = 12

  const formatResetTime = (resetsAt: string) => {
    const resetDate = new Date(resetsAt)
    if (Number.isNaN(resetDate.getTime())) return null
    const now = new Date()
    const diffMs = resetDate.getTime() - now.getTime()
    if (diffMs <= 0) return "soon"

    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMins / 60)
    const diffDays = Math.floor(diffHours / 24)

    if (diffMins < 60) return `${diffMins}m`
    if (diffHours < 24) return `${diffHours}h ${diffMins % 60}m`
    if (diffDays === 1) return "tomorrow"
    return `${diffDays}d`
  }

  const formatSidebarLabel = (label: string) => label.replace(/\s*\([^)]*\)\s*$/, "")

  const renderCompactBar = (w: RateWindow) => {
    const usedPct = Math.min(100, Math.max(0, w.usedPercent))
    const filledWidth = Math.round((usedPct / 100) * barWidth)
    const emptyWidth = barWidth - filledWidth

    const barColor = usedPct >= 90 ? theme.error : usedPct >= 75 ? theme.warning : theme.success

    const resetText = w.resetsAt ? formatResetTime(w.resetsAt) : null
    const labelText = Locale.truncate(formatSidebarLabel(w.label), 12)
    const label = labelText.padEnd(12)

    return (
      <box flexDirection="row" gap={1}>
        <text fg={theme.textMuted} flexShrink={0}>
          {label}
        </text>
        <text flexShrink={0}>
          <span style={{ fg: barColor }}>{"█".repeat(filledWidth)}</span>
          <span style={{ fg: theme.textMuted }}>{"░".repeat(emptyWidth)}</span>
        </text>
        <text fg={theme.textMuted} flexShrink={0}>
          {Math.round(usedPct)}%{resetText ? ` (${resetText})` : ""}
        </text>
      </box>
    )
  }

  return (
    <box>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text}>
          <b>Usage</b>
        </text>
        <text fg={theme.textMuted} onMouseDown={props.onHide}>
          ✕
        </text>
      </box>
      <Switch>
        <Match when={u().status === "unlimited"}>
          <text fg={theme.success}>Unlimited</text>
        </Match>
        <Match when={u().status === "ok"}>
          <Show when={u().primary}>{renderCompactBar(u().primary!)}</Show>
          <Show when={u().secondary}>{renderCompactBar(u().secondary!)}</Show>
        </Match>
        <Match when={u().status === "error"}>
          <text fg={theme.warning}>{u().error ?? "Unable to fetch"}</text>
        </Match>
        <Match when={u().status === "unsupported"}>
          <text fg={theme.textMuted}>Not available</text>
        </Match>
      </Switch>
    </box>
  )
}
