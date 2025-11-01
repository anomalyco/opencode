import { useSync } from "@tui/context/sync"
import { createMemo, createSignal, For, Show, Switch, Match } from "solid-js"
import { useTheme } from "../../context/theme"
import { Locale } from "@/util/locale"
import path from "path"
import type { AssistantMessage } from "@opencode-ai/sdk"
import { TextAttributes } from "@opentui/core"
import { ContextUsageBar } from "../../component/context-usage-bar"
import { useLocal } from "../../context/local"
import { useKeyboard, useRenderer } from "@opentui/solid"
import { useSDK } from "../../context/sdk"

type TabType = "files" | "todos" | "mcp"

export function Sidebar(props: { sessionID: string; onToggle: () => void }) {
  const sync = useSync()
  const { theme } = useTheme()
  const local = useLocal()
  const renderer = useRenderer()
  const sdk = useSDK()
  const [activeTab, setActiveTab] = createSignal<TabType>("mcp")
  const [expandedMcpServers, setExpandedMcpServers] = createSignal<Set<string>>(new Set())
  const [mcpTools, setMcpTools] = createSignal<Record<string, Record<string, any>>>({})
  const session = createMemo(() => sync.session.get(props.sessionID)!)
  const todo = createMemo(() => sync.data.todo[props.sessionID] ?? [])
  const messages = createMemo(() => sync.data.message[props.sessionID] ?? [])

  // Add keyboard shortcuts for tab switching
  useKeyboard((evt) => {
    if (evt.name === "1") setActiveTab("mcp")
    if (evt.name === "2") setActiveTab("todos")
    if (evt.name === "3") setActiveTab("files")
  })

  async function toggleMcpServer(serverName: string) {
    const expanded = expandedMcpServers()
    const newExpanded = new Set(expanded)

    if (expanded.has(serverName)) {
      newExpanded.delete(serverName)
    } else {
      newExpanded.add(serverName)
      // Load tools if not already loaded
      if (!mcpTools()[serverName]) {
        try {
          // After SDK regeneration, this should work as sdk.client.mcp.serverTools()
          // For now using fetch as fallback until SDK is regenerated
          const response = await fetch(
            `http://localhost:4096/mcp/${encodeURIComponent(serverName)}/tools`,
          )
          if (response.ok) {
            const tools = await response.json()
            setMcpTools((prev) => ({ ...prev, [serverName]: tools }))
          }
        } catch (error) {
          console.error(`Failed to load tools for ${serverName}:`, error)
          setMcpTools((prev) => ({ ...prev, [serverName]: {} }))
        }
      }
    }

    setExpandedMcpServers(newExpanded)
  }

  const cost = createMemo(() => {
    const total = messages().reduce((sum, x) => sum + (x.role === "assistant" ? x.cost : 0), 0)
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(total)
  })

  const context = createMemo(() => {
    const last = messages().findLast(
      (x) => x.role === "assistant" && x.tokens.output > 0,
    ) as AssistantMessage
    if (!last) return { tokens: 0, tokenLimit: 0, tokensFormatted: "0", percentage: 0 }

    const total =
      last.tokens.input +
      last.tokens.output +
      last.tokens.reasoning +
      last.tokens.cache.read +
      last.tokens.cache.write
    const model = sync.data.provider.find((x) => x.id === last.providerID)?.models[last.modelID]
    const tokenLimit = model?.limit.context || 0

    return {
      tokens: total,
      tokenLimit,
      tokensFormatted: total.toLocaleString(),
      percentage: tokenLimit ? Math.round((total / tokenLimit) * 100) : 0,
    }
  })

  return (
    <Show when={session()}>
      <box flexShrink={0} gap={1} width={40}>
        <box flexDirection="row" justifyContent="space-between" paddingRight={1}>
          <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
            CODESURF
          </text>
          <text
            fg={theme.textMuted}
            onMouseUp={() => {
              if (renderer.getSelection()?.getSelectedText()) return
              props.onToggle()
            }}
          >
            ▶
          </text>
        </box>
        <box>
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
          <ContextUsageBar
            currentTokens={context().tokens}
            tokenLimit={context().tokenLimit}
            agentColor={local.agent.color("assistant")}
            backgroundColor={theme.backgroundPanel}
            width={40}
          />
          <text fg={theme.textMuted}>{context().tokensFormatted} tokens</text>
          <text fg={theme.textMuted}>{context().percentage}% used</text>
          <text fg={theme.textMuted}>{cost()} spent</text>
        </box>

        {/* Tab Navigation */}
        <box flexDirection="row" gap={2}>
          <text
            style={{
              fg: activeTab() === "mcp" ? theme.accent : theme.textMuted,
              attributes: activeTab() === "mcp" ? TextAttributes.BOLD : undefined,
            }}
            onMouseUp={() => setActiveTab("mcp")}
          >
            {activeTab() === "mcp" ? "●" : "○"} MCP/LSP(
            {Object.keys(sync.data.mcp).length + sync.data.lsp.length})
          </text>
          <text
            style={{
              fg: activeTab() === "todos" ? theme.accent : theme.textMuted,
              attributes: activeTab() === "todos" ? TextAttributes.BOLD : undefined,
            }}
            onMouseUp={() => setActiveTab("todos")}
          >
            {activeTab() === "todos" ? "●" : "○"} Todos({todo().length})
          </text>
          <text
            style={{
              fg: activeTab() === "files" ? theme.accent : theme.textMuted,
              attributes: activeTab() === "files" ? TextAttributes.BOLD : undefined,
            }}
            onMouseUp={() => setActiveTab("files")}
          >
            {activeTab() === "files" ? "●" : "○"} Files({session().summary?.diffs?.length || 0})
          </text>
        </box>

        {/* Tab Content */}
        <Show when={activeTab() === "mcp"}>
          <Show when={sync.data.lsp.length > 0}>
            <box marginTop={0}>
              <text>
                <b>LSP</b>
              </text>
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
            </box>
          </Show>
          <Show when={Object.keys(sync.data.mcp).length > 0}>
            <box marginTop={0}>
              <text>
                <b>MCP</b>
              </text>
              <For each={Object.entries(sync.data.mcp)}>
                {([key, item]) => (
                  <box flexDirection="column">
                    <box flexDirection="row" gap={1}>
                      <text
                        flexShrink={0}
                        style={{
                          fg: {
                            connected: theme.success,
                            failed: theme.error,
                            disabled: theme.textMuted,
                          }[item.status],
                        }}
                      >
                        •
                      </text>
                      <text
                        wrapMode="word"
                        fg={theme.accent}
                        attributes={TextAttributes.BOLD}
                        onMouseUp={() => {
                          if (renderer.getSelection()?.getSelectedText()) return
                          toggleMcpServer(key)
                        }}
                      >
                        {expandedMcpServers().has(key) ? "▼" : "▶"} {key}
                      </text>
                      <text fg={theme.textMuted}>
                        <Switch>
                          <Match when={item.status === "connected"}>Connected</Match>
                          <Match when={item.status === "failed" && item}>
                            {(val) => <i>{val().error}</i>}
                          </Match>
                          <Match when={item.status === "disabled"}>Disabled</Match>
                        </Switch>
                      </text>
                    </box>
                    <Show when={expandedMcpServers().has(key) && mcpTools()[key]}>
                      <box marginLeft={3} flexDirection="column">
                        <For each={Object.entries(mcpTools()[key] || {})}>
                          {([toolName, tool]) => <text fg={theme.textMuted}>⚙ {toolName}</text>}
                        </For>
                      </box>
                    </Show>
                  </box>
                )}
              </For>
            </box>
          </Show>
        </Show>

        <Show when={activeTab() === "todos"}>
          <Show when={todo().length > 0}>
            <box marginTop={0}>
              <text>
                <b>Todo</b>
              </text>
              <For each={todo()}>
                {(todo) => (
                  <text
                    style={{ fg: todo.status === "in_progress" ? theme.success : theme.textMuted }}
                  >
                    [{todo.status === "completed" ? "✓" : " "}] {todo.content}
                  </text>
                )}
              </For>
            </box>
          </Show>
        </Show>

        <Show when={activeTab() === "files"}>
          <Show when={session().summary?.diffs}>
            <box marginTop={0}>
              <text>
                <b>Modified Files</b>
              </text>
              <For each={session().summary?.diffs || []}>
                {(item) => {
                  const file = createMemo(() => {
                    const splits = item.file.split(path.sep).filter(Boolean)
                    const last = splits.at(-1)!
                    const rest = splits.slice(0, -1).join(path.sep)
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
            </box>
          </Show>
        </Show>
      </box>
    </Show>
  )
}
