import { useSync } from "@tui/context/sync"
import { createMemo, For, Show, Switch, Match } from "solid-js"
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
    models: true,
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

  // Provider usage statistics (including Antigravity)
  const providerUsage = createMemo(() => {
    const usage: Record<string, { input: number; output: number; cost: number; requests: number }> = {}

    for (const msg of messages()) {
      if (msg.role !== "assistant") continue
      const assistant = msg as AssistantMessage

      // Determine provider name
      let providerName = assistant.providerID || "unknown"
      const modelID = assistant.modelID || ""

      // Check if it's an Antigravity model
      if (modelID.includes("antigravity") || providerName.includes("antigravity")) {
        providerName = "antigravity"
      } else if (providerName === "google" && modelID.includes("antigravity")) {
        providerName = "antigravity"
      }

      if (!usage[providerName]) {
        usage[providerName] = { input: 0, output: 0, cost: 0, requests: 0 }
      }

      usage[providerName].input += assistant.tokens.input + assistant.tokens.cache.read
      usage[providerName].output += assistant.tokens.output + assistant.tokens.reasoning
      usage[providerName].cost += assistant.cost
      usage[providerName].requests += 1
    }

    // Sort by total tokens descending
    return Object.entries(usage)
      .map(([provider, stats]) => ({ provider, ...stats, total: stats.input + stats.output }))
      .sort((a, b) => b.total - a.total)
  })

  // Model usage statistics (per-model breakdown)
  const modelUsage = createMemo(() => {
    const usage: Record<string, { provider: string; input: number; output: number; cost: number; requests: number }> = {}

    for (const msg of messages()) {
      if (msg.role !== "assistant") continue
      const assistant = msg as AssistantMessage

      const providerName = assistant.providerID || "unknown"
      const modelID = assistant.modelID || "unknown"
      const key = `${providerName}:${modelID}`

      if (!usage[key]) {
        usage[key] = { provider: providerName, input: 0, output: 0, cost: 0, requests: 0 }
      }

      usage[key].input += assistant.tokens.input + assistant.tokens.cache.read
      usage[key].output += assistant.tokens.output + assistant.tokens.reasoning
      usage[key].cost += assistant.cost
      usage[key].requests += 1
    }

    // Sort by total tokens descending
    return Object.entries(usage)
      .map(([key, stats]) => {
        const modelID = key.split(":").slice(1).join(":")
        return { model: modelID, ...stats, total: stats.input + stats.output }
      })
      .sort((a, b) => b.total - a.total)
  })

  const formatCost = (n: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 4,
      maximumFractionDigits: 4,
    }).format(n)
  }

  const shortenModelName = (model: string) => {
    // Shorten common model names for display
    return model
      .replace("claude-", "")
      .replace("gpt-", "")
      .replace("gemini-", "")
      .replace("-latest", "")
      .replace("-20250514", "")
      .replace("-20250219", "")
      .replace("-20241022", "")
      .replace("-20240620", "")
  }

  const formatTokens = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
    return n.toString()
  }

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
            </box>
            <Show when={providerUsage().length > 0}>
              <box>
                <text fg={theme.text}>
                  <b>Provider Usage</b>
                </text>
                <For each={providerUsage()}>
                  {(item) => {
                    const providerIcon = () => {
                      switch (item.provider.toLowerCase()) {
                        case "antigravity": return "🌌"
                        case "anthropic": return "🟣"
                        case "google": return "🔵"
                        case "openai": return "🟢"
                        default: return "⚪"
                      }
                    }
                    const percentage = () => {
                      const total = providerUsage().reduce((sum, p) => sum + p.total, 0)
                      return total > 0 ? Math.round((item.total / total) * 100) : 0
                    }
                    return (
                      <box flexDirection="row" gap={1} justifyContent="space-between">
                        <text fg={theme.text} wrapMode="char">
                          {providerIcon()} {item.provider}
                        </text>
                        <text fg={theme.textMuted} flexShrink={0}>
                          {formatTokens(item.total)} ({percentage()}%)
                        </text>
                      </box>
                    )
                  }}
                </For>
              </box>
            </Show>
            <Show when={modelUsage().length > 0}>
              <box>
                <box
                  flexDirection="row"
                  gap={1}
                  onMouseDown={() => modelUsage().length > 3 && setExpanded("models", !expanded.models)}
                >
                  <Show when={modelUsage().length > 3}>
                    <text fg={theme.text}>{expanded.models ? "▼" : "▶"}</text>
                  </Show>
                  <text fg={theme.text}>
                    <b>Model Usage</b>
                    <Show when={!expanded.models}>
                      <span style={{ fg: theme.textMuted }}> ({modelUsage().length} models)</span>
                    </Show>
                  </text>
                </box>
                <Show when={modelUsage().length <= 3 || expanded.models}>
                  <For each={modelUsage()}>
                    {(item) => {
                      const providerIcon = () => {
                        switch (item.provider.toLowerCase()) {
                          case "antigravity": return "🌌"
                          case "anthropic": return "🟣"
                          case "google": return "🔵"
                          case "openai": return "🟢"
                          case "xai": return "⚡"
                          case "groq": return "🟠"
                          case "mistral": return "🔶"
                          case "deepseek": return "🐋"
                          default: return "⚪"
                        }
                      }
                      return (
                        <box>
                          <box flexDirection="row" gap={1} justifyContent="space-between">
                            <text fg={theme.text} wrapMode="char">
                              {providerIcon()} {shortenModelName(item.model)}
                            </text>
                            <text fg={theme.textMuted} flexShrink={0}>
                              {item.requests}x
                            </text>
                          </box>
                          <box flexDirection="row" gap={1} justifyContent="space-between" paddingLeft={2}>
                            <text fg={theme.textMuted}>
                              ↑{formatTokens(item.input)} ↓{formatTokens(item.output)}
                            </text>
                            <text fg={theme.textMuted} flexShrink={0}>
                              {formatCost(item.cost)}
                            </text>
                          </box>
                        </box>
                      )
                    }}
                  </For>
                </Show>
              </box>
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
                      const file = createMemo(() => {
                        const splits = item.file.split(path.sep).filter(Boolean)
                        const last = splits.at(-1)!
                        const rest = splits.slice(0, -1).join(path.sep)
                        if (!rest) return last
                        return Locale.truncateMiddle(rest, 30 - last.length) + "/" + last
                      })
                      return (
                        <box flexDirection="row" gap={1} justifyContent="space-between">
                          <text fg={theme.textMuted} wrapMode="char">
                            {file()}
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
