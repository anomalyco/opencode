import { type Accessor, createMemo, Match, Show, Switch } from "solid-js"
import { useRouteData } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { pipe, sumBy } from "remeda"
import { useTheme } from "@tui/context/theme"
import { SplitBorder } from "@tui/component/border"
import type { AssistantMessage, Session } from "@opencode-ai/sdk"
import { useTerminalDimensions } from "@opentui/solid"
import { Locale } from "@/util/locale"

const Title = (props: { session: Accessor<Session>; maxWidth?: number }) => {
  const { theme } = useTheme()
  const title = createMemo(() => {
    const t = props.session().title
    if (!props.maxWidth) return t
    // Account for "# " prefix (2 chars)
    return Locale.truncateMiddle(t, props.maxWidth - 2)
  })
  return (
    <text fg={theme.text} wrapMode="none" flexShrink={1}>
      <span style={{ bold: true, fg: theme.accent }}>#</span>{" "}
      <span style={{ bold: true }}>{title()}</span>
    </text>
  )
}

const ContextInfo = (props: { context: Accessor<string | undefined>; cost: Accessor<string>; hide?: boolean }) => {
  const { theme } = useTheme()
  return (
    <Show when={props.context() && !props.hide}>
      <text fg={theme.textMuted} wrapMode="none" flexShrink={0}>
        {props.context()} ({props.cost()})
      </text>
    </Show>
  )
}

export function Header() {
  const route = useRouteData("session")
  const sync = useSync()
  const dimensions = useTerminalDimensions()
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

  // Calculate responsive widths based on terminal size
  const layout = createMemo(() => {
    const width = dimensions().width
    const contextLength = (context() || "").length + (cost() || "").length + 4 // " ()" + gap

    // Very narrow: hide context info, give all space to title
    if (width < 40) {
      return { hideContext: true, titleMaxWidth: width - 4 }
    }

    // Narrow: show context if it fits, truncate title
    if (width < 60) {
      const titleSpace = width - contextLength - 6 // padding + gap
      return { hideContext: false, titleMaxWidth: Math.max(15, titleSpace) }
    }

    // Normal: no truncation needed
    return { hideContext: false, titleMaxWidth: undefined }
  })

  const { theme } = useTheme()

  return (
    <box
      paddingLeft={1}
      paddingRight={1}
      {...SplitBorder}
      borderColor={theme.backgroundElement}
      flexShrink={0}
    >
      <Show
        when={shareEnabled()}
        fallback={
          <box flexDirection="row" justifyContent="space-between" gap={1}>
            <Title session={session} maxWidth={layout().titleMaxWidth} />
            <ContextInfo context={context} cost={cost} hide={layout().hideContext} />
          </box>
        }
      >
        <Title session={session} maxWidth={layout().titleMaxWidth} />
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
          <ContextInfo context={context} cost={cost} hide={layout().hideContext} />
        </box>
      </Show>
    </box>
  )
}
