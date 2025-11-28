import { type Accessor, createMemo, Match, Show, Switch } from "solid-js"
import { useRouteData } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { pipe, sumBy } from "remeda"
import { useTheme } from "@tui/context/theme"
import { SplitBorder } from "@tui/component/border"
import type { AssistantMessage, Session } from "@cerebras-ai/sdk"

const Title = (props: { session: Accessor<Session> }) => {
  const { theme } = useTheme()
  return (
    <text fg={theme.text}>
      <span style={{ bold: true, fg: theme.accent }}>#</span>{" "}
      <span style={{ bold: true }}>{props.session().title}</span>
    </text>
  )
}

const ContextInfo = (props: {
  context: Accessor<string | undefined>
  cost: Accessor<string>
  sessionTokens: Accessor<number>
  contextLimit: Accessor<number | undefined>
  budgetPercentage: Accessor<number>
}) => {
  const { theme } = useTheme()

  const budgetColor = createMemo(() => {
    const pct = props.budgetPercentage()
    if (pct >= 0.95) return theme.error
    if (pct >= 0.8) return theme.warning
    return theme.success
  })

  return (
    <Show when={props.context()}>
      <box flexDirection="row" gap={1} flexShrink={0}>
        <text fg={theme.textMuted} wrapMode="none">
          {props.context()} | Session: {props.sessionTokens().toLocaleString()}
          <Show when={props.contextLimit()}>/{props.contextLimit()!.toLocaleString()}</Show>
        </text>
        <text fg={budgetColor()} wrapMode="none">
          ({(props.budgetPercentage() * 100).toFixed(0)}%)
        </text>
        <text fg={theme.textMuted} wrapMode="none">
          {props.cost()}
        </text>
      </box>
    </Show>
  )
}

export function Header() {
  const route = useRouteData("session")
  const sync = useSync()
  const session = createMemo(() => sync.session.get(route.sessionID)!)
  const messages = createMemo(() => sync.data.message[route.sessionID] ?? [])
  const shareEnabled = createMemo(() => sync.data.config.share !== "disabled")

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

  // Calculate total session tokens
  const sessionTokens = createMemo(() => {
    return pipe(
      messages(),
      sumBy((x) => {
        if (x.role === "assistant") {
          return x.tokens.input + x.tokens.output + x.tokens.reasoning + x.tokens.cache.read + x.tokens.cache.write
        }
        return 0
      }),
    )
  })

  // Get current model's context limit
  const contextLimit = createMemo(() => {
    const last = messages().findLast((x) => x.role === "assistant" && x.tokens.output > 0) as AssistantMessage
    if (!last) return undefined
    const model = sync.data.provider.find((x) => x.id === last.providerID)?.models[last.modelID]
    return model?.limit.context
  })

  // Calculate budget percentage (from token budget system)
  const budgetPercentage = createMemo(() => {
    const limit = 1_000_000 // Default token budget
    return Math.min(sessionTokens() / limit, 1)
  })

  const context = createMemo(() => {
    const last = messages().findLast((x) => x.role === "assistant" && x.tokens.output > 0) as AssistantMessage
    if (!last) return
    const total =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    const model = sync.data.provider.find((x) => x.id === last.providerID)?.models[last.modelID]
    let result = total.toLocaleString()
    if (model?.limit.context) {
      result += "/" + Math.round((total / model.limit.context) * 100) + "%"
    }
    return result
  })

  const { theme } = useTheme()

  return (
    <box paddingLeft={1} paddingRight={1} {...SplitBorder} borderColor={theme.backgroundElement} flexShrink={0}>
      <Show
        when={shareEnabled()}
        fallback={
          <box flexDirection="row" justifyContent="space-between" gap={1}>
            <Title session={session} />
            <ContextInfo
              context={context}
              cost={cost}
              sessionTokens={sessionTokens}
              contextLimit={contextLimit}
              budgetPercentage={budgetPercentage}
            />
          </box>
        }
      >
        <Title session={session} />
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
          <ContextInfo
            context={context}
            cost={cost}
            sessionTokens={sessionTokens}
            contextLimit={contextLimit}
            budgetPercentage={budgetPercentage}
          />
        </box>
      </Show>
    </box>
  )
}
