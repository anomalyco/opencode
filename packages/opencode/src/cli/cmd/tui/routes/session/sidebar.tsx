import { useSync } from "@tui/context/sync"
import { createMemo, For, Show, Switch, Match } from "solid-js"
import { useTheme } from "../../context/theme"
import { Locale } from "@/util/locale"
import path from "path"
import type { AssistantMessage } from "@opencode-ai/sdk"

export function Sidebar(props: { sessionID: string }) {
  const sync = useSync()
  const { theme } = useTheme()
  const session = createMemo(() => sync.session.get(props.sessionID)!)
  const todo = createMemo(() => sync.data.todo[props.sessionID] ?? [])
  const messages = createMemo(() => sync.data.message[props.sessionID] ?? [])

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
    if (!last) return
    const total =
      last.tokens.input +
      last.tokens.output +
      last.tokens.reasoning +
      last.tokens.cache.read +
      last.tokens.cache.write
    const model = sync.data.provider.find((x) => x.id === last.providerID)?.models[last.modelID]
    return {
      tokens: total.toLocaleString(),
      percentage: model?.limit.context ? Math.round((total / model.limit.context) * 100) : null,
    }
  })

  return (
    <Show when={session()}>
      <box flexShrink={0} gap={1} width={40}>
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
          <text fg={theme.textMuted}>{context()?.tokens ?? 0} tokens</text>
          <text fg={theme.textMuted}>{context()?.percentage ?? 0}% used</text>
          <text fg={theme.textMuted}>{cost()} spent</text>
        </box>
        <Show when={Object.keys(sync.data.mcp).length > 0}>
          <box>
            <text fg={theme.text}>
              <b>MCP</b>
            </text>
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
                        <Match when={item.status === "failed" && item}>
                          {(val) => <i>{val().error}</i>}
                        </Match>
                        <Match when={item.status === "disabled"}>Disabled in configuration</Match>
                      </Switch>
                    </span>
                  </text>
                </box>
              )}
            </For>
          </box>
        </Show>
        <Show when={sync.data.lsp.length > 0}>
          <box>
            <text fg={theme.text}>
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
        <Show when={session().summary?.diffs}>
          <box>
            <text fg={theme.text}>
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
        <Show when={todo().length > 0}>
          <box>
            <text fg={theme.text}>
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
      </box>
    </Show>
  )
}
