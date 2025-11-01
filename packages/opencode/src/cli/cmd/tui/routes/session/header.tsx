import { createMemo, Match, Show, Switch } from "solid-js"
import { useRouteData } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { pipe, sumBy } from "remeda"
import { useTheme } from "@tui/context/theme"
import { SplitBorder } from "@tui/component/border"
import type { AssistantMessage } from "@opencode-ai/sdk"

export function Header() {
  const route = useRouteData("session")
  const sync = useSync()
  const { theme } = useTheme()
  const session = createMemo(() => sync.session.get(route.sessionID)!)
  const messages = createMemo(() => sync.data.message[route.sessionID] ?? [])

  const cost = createMemo(() => {
    const total = pipe(
      messages(),
      sumBy((x) => (x.role === "assistant" ? x.cost : 0)),
    )
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
    let result = total.toLocaleString()
    if (model?.limit.context) {
      result += "/" + Math.round((total / model.limit.context) * 100) + "%"
    }
    return result
  })

  return (
    <box
      paddingLeft={1}
      paddingRight={1}
      {...SplitBorder}
      borderColor={theme.backgroundElement}
      flexShrink={0}
    >
      <text fg={theme.text}>
        <span style={{ bold: true, fg: theme.accent }}>#</span>{" "}
        <span style={{ bold: true }}>{session().title}</span>
      </text>
      <box flexDirection="row" justifyContent="space-between" gap={1}>
        <box flexGrow={1} flexShrink={1}>
          <Switch>
            <Match when={session().share?.url}>
              <text fg={theme.textMuted} wrapMode="word">
                {session().share!.url}
              </text>
            </Match>
            <Match when={true}>
              <text fg={theme.text} wrapMode="word">
                /share <span style={{ fg: theme.textMuted }}>to create a shareable link</span>
              </text>
            </Match>
          </Switch>
        </box>
        <Show when={context()}>
          <text fg={theme.textMuted} wrapMode="none" flexShrink={0}>
            {context()} ({cost()})
          </text>
        </Show>
      </box>
    </box>
  )
}
