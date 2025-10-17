import { useSync } from "@tui/context/sync"
import { createMemo, For, Show, Switch, Match } from "solid-js"
import { Theme } from "../../context/theme"
import { Locale } from "@/util/locale"
import type { AssistantMessage } from "@opencode-ai/sdk"

export function Sidebar(props: { sessionID: string }) {
  const sync = useSync()
  const session = createMemo(() => sync.session.get(props.sessionID)!)
  const todo = createMemo(() => sync.data.todo[props.sessionID] ?? [])
  const messages = createMemo(() => sync.data.message[props.sessionID] ?? [])
  const files = createMemo(() => {
    const result = new Set<string>()
    for (const msg of messages()) {
      const parts = sync.data.part[msg.id] ?? []
      for (const part of parts) {
        if (part.type === "patch") {
          for (const file of part.files) {
            result.add(file)
          }
        }
      }
    }
    return [...result.values()].sort((a, b) => a.length - b.length)
  })

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

  return (
    <Show when={session()}>
      <box flexShrink={0} gap={1} width={40}>
        <box>
          <text>
            <b>{session().title}</b>
          </text>
          <Show when={session().share?.url}>
            <text fg={Theme().textMuted}>{session().share!.url}</text>
          </Show>
        </box>
        <box>
          <text>
            <b>Context</b>
          </text>
          <text fg={Theme().textMuted}>{context()?.tokens ?? 0} tokens</text>
          <text fg={Theme().textMuted}>{context()?.percentage ?? 0}% used</text>
          <text fg={Theme().textMuted}>{cost()} spent</text>
        </box>
        <Show when={Object.keys(sync.data.mcp).length > 0}>
          <box>
            <text>
              <b>MCP</b>
            </text>
            <For each={Object.entries(sync.data.mcp)}>
              {([key, item]) => (
                <box flexDirection="row" gap={1}>
                  <text
                    flexShrink={0}
                    style={{
                      fg: {
                        connected: Theme().success,
                        failed: Theme().error,
                        disabled: Theme().textMuted,
                      }[item.status],
                    }}
                  >
                    •
                  </text>
                  <text wrapMode="word">
                    {key}{" "}
                    <span style={{ fg: Theme().textMuted }}>
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
          </box>
        </Show>
        <Show when={sync.data.lsp.length > 0}>
          <box>
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
                        connected: Theme().success,
                        error: Theme().error,
                      }[item.status],
                    }}
                  >
                    •
                  </text>
                  <text fg={Theme().textMuted}>
                    {item.id} {item.root}
                  </text>
                </box>
              )}
            </For>
          </box>
        </Show>
        <Show when={files().length > 0}>
          <box>
            <text>
              <b>Modified Files</b>
            </text>
            <For each={files()}>{(file) => <text fg={Theme().textMuted}>{Locale.truncateMiddle(file, 40)}</text>}</For>
          </box>
        </Show>
        <Show when={todo().length > 0}>
          <box>
            <text>
              <b>Todo</b>
            </text>
            <For each={todo()}>
              {(todo) => (
                <text style={{ fg: todo.status === "in_progress" ? Theme().success : Theme().textMuted }}>
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
