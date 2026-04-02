import { createMemo, Show } from "solid-js"
import { useRouteData } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import { SplitBorder } from "@tui/component/border"
import type { AssistantMessage } from "@opencode-ai/sdk/v2"
import { useTerminalDimensions } from "@opentui/solid"
import { Locale } from "@/util/locale"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

export function Header() {
  const route = useRouteData("session")
  const sync = useSync()
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()
  const session = createMemo(() => sync.session.get(route.sessionID))
  const msg = createMemo(() => sync.data.message[route.sessionID] ?? [])
  const narrow = createMemo(() => dimensions().width < 80)
  const usage = createMemo(() => {
    const last = msg().findLast((item): item is AssistantMessage => item.role === "assistant" && item.tokens.output > 0)
    if (!last) return

    const tokens =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    if (tokens <= 0) return

    const model = sync.data.provider.find((item) => item.id === last.providerID)?.models[last.modelID]
    const pct = model?.limit.context ? `${Math.round((tokens / model.limit.context) * 100)}%` : undefined
    const cost = msg().reduce((sum, item) => sum + (item.role === "assistant" ? item.cost : 0), 0)
    return {
      context: pct ? `${Locale.number(tokens)}  ${pct}` : Locale.number(tokens),
      cost: cost > 0 ? money.format(cost) : undefined,
    }
  })

  return (
    <Show when={session()}>
      <box flexShrink={0}>
        <box
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={2}
          paddingRight={1}
          {...SplitBorder}
          border={["left"]}
          borderColor={theme.border}
          flexShrink={0}
          backgroundColor={theme.backgroundPanel}
        >
          <box flexDirection={narrow() ? "column" : "row"} justifyContent="space-between" gap={1}>
            <text fg={theme.text}>
              <span style={{ bold: true }}>#</span> <span style={{ bold: true }}>{session()!.title}</span>
            </text>
            <Show when={usage()}>
              {(item) => (
                <text fg={theme.textMuted} wrapMode="none" flexShrink={0}>
                  {[item().context, item().cost].filter(Boolean).join("  ")}
                </text>
              )}
            </Show>
          </box>
        </box>
      </box>
    </Show>
  )
}
