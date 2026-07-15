import { createMemo, createSignal, Show } from "solid-js"
import { useRouteData } from "../../context/route"
import { useData } from "../../context/data"
import { useTheme } from "../../context/theme"
import { SplitBorder } from "../../ui/border"
import { Locale } from "../../util/locale"
import { useTerminalDimensions } from "@opentui/solid"
import { Keymap } from "../../context/keymap"
import { contextUsage } from "../../util/session"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

export function SubagentFooter() {
  const route = useRouteData("session")
  const data = useData()
  const session = createMemo(() => data.session.get(route.sessionID))

  const subagentInfo = createMemo(() => {
    const s = session()
    if (!s) return "Subagent"
    const agentMatch = s.title.match(/@(\w+) subagent/)
    return agentMatch ? Locale.titlecase(agentMatch[1]) : "Subagent"
  })

  const usage = createMemo(() => {
    const current = session()
    if (!current) return
    const cost = current.cost
    const formattedCost = cost > 0 ? money.format(cost) : undefined
    const context = contextUsage(
      data.session.message.list(route.sessionID),
      data.location.model.list(current.location),
      current.revert?.messageID,
    )

    return {
      context: context
        ? context.percent === undefined
          ? Locale.number(context.tokens)
          : `${Locale.number(context.tokens)} (${context.percent}%)`
        : undefined,
      cost: formattedCost,
    }
  })

  const { themeV2 } = useTheme().contextual("elevated")
  const keymap = Keymap.use()
  const shortcuts = Keymap.useShortcuts()
  const [hover, setHover] = createSignal<"parent" | "prev" | "next" | null>(null)
  useTerminalDimensions()

  return (
    <box flexShrink={0}>
      <box
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={1}
        {...SplitBorder}
        border={["left"]}
        borderColor={themeV2.border()}
        flexShrink={0}
        backgroundColor={themeV2.background()}
      >
        <box flexDirection="row" justifyContent="space-between" gap={1}>
          <box flexDirection="row" gap={1}>
            <text fg={themeV2.text()}>
              <b>{subagentInfo()}</b>
            </text>
            <Show when={usage()}>
              {(item) => (
                <text fg={themeV2.text.subdued()} wrapMode="none">
                  {[item().context, item().cost].filter(Boolean).join(" · ")}
                </text>
              )}
            </Show>
          </box>
          <box flexDirection="row" gap={2}>
            <box
              onMouseOver={() => setHover("parent")}
              onMouseOut={() => setHover(null)}
              onMouseUp={() => keymap.dispatch("session.parent")}
              backgroundColor={hover() === "parent" ? themeV2.background.action.secondary("focused") : themeV2.background()}
            >
              <text fg={themeV2.text()}>
                Parent <span style={{ fg: themeV2.text.subdued() }}>{shortcuts.get("session.parent")}</span>
              </text>
            </box>
            <box
              onMouseOver={() => setHover("prev")}
              onMouseOut={() => setHover(null)}
              onMouseUp={() => keymap.dispatch("session.child.previous")}
              backgroundColor={hover() === "prev" ? themeV2.background.action.secondary("focused") : themeV2.background()}
            >
              <text fg={themeV2.text()}>
                Prev <span style={{ fg: themeV2.text.subdued() }}>{shortcuts.get("session.child.previous")}</span>
              </text>
            </box>
            <box
              onMouseOver={() => setHover("next")}
              onMouseOut={() => setHover(null)}
              onMouseUp={() => keymap.dispatch("session.child.next")}
              backgroundColor={hover() === "next" ? themeV2.background.action.secondary("focused") : themeV2.background()}
            >
              <text fg={themeV2.text()}>
                Next <span style={{ fg: themeV2.text.subdued() }}>{shortcuts.get("session.child.next")}</span>
              </text>
            </box>
          </box>
        </box>
      </box>
    </box>
  )
}
