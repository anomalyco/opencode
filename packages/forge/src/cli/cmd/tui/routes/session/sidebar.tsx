import { useSync } from "@tui/context/sync"
import { createMemo, For, Show, Switch, Match, createSignal } from "solid-js"
import { useTheme } from "../../context/theme"
import { Locale } from "@/util/locale"
import path from "path"
import type { AssistantMessage } from "@forge/sdk"

export function Sidebar(props: { sessionID: string }) {
  const sync = useSync()
  const { theme } = useTheme()
  const session = createMemo(() => sync.session.get(props.sessionID)!)
  const diff = createMemo(() => sync.data.session_diff[props.sessionID] ?? [])
  const plan = createMemo(() => sync.data.plan[props.sessionID] ?? [])
  const messages = createMemo(() => sync.data.message[props.sessionID] ?? [])

  const [mcpExpanded, setMcpExpanded] = createSignal(true)
  const [diffExpanded, setDiffExpanded] = createSignal(true)
  const [planExpanded, setPlanExpanded] = createSignal(true)

  // NOTE: Cost/Context calculations commented out - ACP agents don't provide token/cost data
  // Always shows $0.00 and 0 tokens, which is misleading for users
  //
  // const cost = createMemo(() => {
  //   const total = messages().reduce((sum, x) => sum + (x.role === "assistant" ? x.cost : 0), 0)
  //   return new Intl.NumberFormat("en-US", {
  //     style: "currency",
  //     currency: "USD",
  //   }).format(total)
  // })
  //
  // const context = createMemo(() => {
  //   const last = messages().findLast((x) => x.role === "assistant" && x.tokens.output > 0) as AssistantMessage
  //   if (!last) return
  //   const total =
  //     last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
  //   return {
  //     tokens: total.toLocaleString(),
  //     percentage: null,
  //   }
  // })

  return (
    <Show when={session()}>
      <scrollbox width={40}>
        <box flexShrink={0} gap={1} paddingRight={1}>
          <box>
            <text fg={theme.text}>
              <b>{session().title}</b>
            </text>
            <Show when={session().share?.url}>
              <text fg={theme.textMuted}>{session().share!.url}</text>
            </Show>
          </box>
          {/* Cost/Context section commented out - not available from ACP agents */}
          {/* <box>
            <text fg={theme.text}>
              <b>Context</b>
            </text>
            <text fg={theme.textMuted}>{context()?.tokens ?? 0} tokens</text>
            <text fg={theme.textMuted}>{context()?.percentage ?? 0}% used</text>
            <text fg={theme.textMuted}>{cost()} spent</text>
          </box> */}
          <Show when={Object.keys(sync.data.mcp).length > 0}>
            <box>
              <box
                flexDirection="row"
                gap={1}
                onMouseDown={() => Object.keys(sync.data.mcp).length > 2 && setMcpExpanded(!mcpExpanded())}
              >
                <Show when={Object.keys(sync.data.mcp).length > 2}>
                  <text fg={theme.text}>{mcpExpanded() ? "▼" : "▶"}</text>
                </Show>
                <text fg={theme.text}>
                  <b>MCP</b>
                </text>
              </box>
              <Show when={Object.keys(sync.data.mcp).length <= 2 || mcpExpanded()}>
                <For each={Object.entries(sync.data.mcp)}>
                  {([key, item]) => (
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
                      <text fg={theme.text} wrapMode="word">
                        {key}{" "}
                        <span style={{ fg: theme.textMuted }}>
                          <Switch>
                            <Match when={item.status === "connected"}>Connected</Match>
                            <Match when={item.status === "failed" && item}>{(val) => <i>{val().error}</i>}</Match>
                            <Match when={item.status === "disabled"}>Disabled in configuration</Match>
                          </Switch>
                        </span>
                      </text>
                    </box>
                  )}
                </For>
              </Show>
            </box>
          </Show>
          {/* LSP section removed - Forge-internal only, ACP agents have no access */}
          <Show when={plan().length > 0}>
            <box>
              <box
                flexDirection="row"
                gap={1}
                onMouseDown={() => plan().length > 2 && setPlanExpanded(!planExpanded())}
              >
                <Show when={plan().length > 2}>
                  <text fg={theme.text}>{planExpanded() ? "▼" : "▶"}</text>
                </Show>
                <text fg={theme.text}>
                  <b>Plan</b>
                </text>
              </box>
              <Show when={plan().length <= 2 || planExpanded()}>
                <For each={plan()}>
                  {(entry) => {
                    // Status checkbox
                    let statusSymbol = "☐" // incomplete/in_progress - empty checkbox
                    let statusColor = theme.text
                    let textColor = theme.text // default to normal white
                    let displayContent = entry.content

                    if (entry.status === "in_progress") {
                      statusSymbol = "☐" // in progress - empty checkbox
                      statusColor = theme.text
                      textColor = theme.text
                      displayContent = entry.content // bold handled by wrapper
                    } else if (entry.status === "completed") {
                      statusSymbol = "☒" // completed - x'd out checkbox
                      statusColor = theme.textMuted
                      textColor = theme.textMuted
                      // Apply strikethrough using Unicode combining character
                      displayContent = entry.content
                        .split("")
                        .map((char) => char + "\u0336")
                        .join("")
                    }

                    return (
                      <box flexDirection="row">
                        <text style={{ fg: statusColor }} flexShrink={0}>
                          {statusSymbol}{" "}
                        </text>
                        <text style={{ fg: textColor }}>
                          {entry.status === "in_progress" ? (
                            <b>
                              {displayContent} • {entry.priority}
                            </b>
                          ) : (
                            <>
                              {displayContent} • {entry.priority}
                            </>
                          )}
                        </text>
                      </box>
                    )
                  }}
                </For>
              </Show>
            </box>
          </Show>
          <Show when={diff().length > 0}>
            <box>
              <box
                flexDirection="row"
                gap={1}
                onMouseDown={() => diff().length > 2 && setDiffExpanded(!diffExpanded())}
              >
                <Show when={diff().length > 2}>
                  <text fg={theme.text}>{diffExpanded() ? "▼" : "▶"}</text>
                </Show>
                <text fg={theme.text}>
                  <b>Modified Files</b>
                </text>
              </box>
              <Show when={diff().length <= 2 || diffExpanded()}>
                <For each={diff() || []}>
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
              </Show>
            </box>
          </Show>
        </box>
      </scrollbox>
    </Show>
  )
}
