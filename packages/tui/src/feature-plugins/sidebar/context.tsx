import { Plugin } from "@opencode/plugin/tui"
import { createMemo, createSignal, Show } from "solid-js"
import { useConfig } from "../../config"
import { contextUsage } from "../../util/session"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

const wholeMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
})

const shortNumber = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
})

export function SidebarContext(props: { context: Plugin.Context; sessionID: string }) {
  const theme = props.context.theme
  const config = useConfig()
  const [view, updateView] = props.context.storage.store("view", {
    initial: { mode: "config" as "config" | "expanded" | "compact" },
  })
  const msg = createMemo(() => props.context.data.session.message.list(props.sessionID))
  const session = createMemo(() => props.context.data.session.get(props.sessionID))
  const cost = createMemo(() => props.context.data.session.cost(props.sessionID))
  const [width, setWidth] = createSignal(0)

  const state = createMemo(() =>
    contextUsage(msg(), props.context.data.location.model.list(session()?.location), session()?.revert?.messageID),
  )
  const compact = createMemo(() =>
    view.mode === "config" ? config.data.session.context === "compact" : view.mode === "compact",
  )
  const toggle = () =>
    void updateView((draft) => {
      draft.mode = compact() ? "expanded" : "compact"
    }).catch((error) => console.error("Failed to persist context sidebar state", error))

  // The sidebar width is not fixed, so compact mode shows the most detailed line that fits beside the toggle icon.
  const line = createMemo(() => {
    const usage = state()
    const spent = cost()
    const tokens = usage?.tokens ?? 0
    const percent = usage?.percent === undefined ? [] : [`${usage.percent}%`]
    const variants = [
      [`${tokens.toLocaleString()} tokens`, ...percent.map((value) => `${value} used`), `${money.format(spent)} spent`],
      [tokens.toLocaleString(), ...percent, money.format(spent)],
      [shortNumber.format(tokens), ...percent, (spent >= 1 ? wholeMoney : money).format(spent)],
    ].map((parts) => parts.join(" · "))
    return variants.find((item) => item.length <= width() - 2) ?? variants[variants.length - 1]
  })

  return (
    <Show when={state() || cost() > 0}>
      <box
        onSizeChange={function () {
          setWidth(this.width)
        }}
      >
        <Show
          when={compact()}
          fallback={
            <>
              <box flexDirection="row" gap={1} onMouseDown={toggle}>
                <text fg={theme.text.base}>▼</text>
                <text fg={theme.text.base}>
                  <b>Context</b>
                </text>
              </box>
              <Show when={state()}>
                {(value) => (
                  <>
                    <text fg={theme.text.muted}>{value().tokens.toLocaleString()} tokens</text>
                    <Show when={value().percent !== undefined}>
                      <text fg={theme.text.muted}>{value().percent}% used</text>
                    </Show>
                  </>
                )}
              </Show>
              <Show when={cost() > 0}>
                <text fg={theme.text.muted}>{money.format(cost())} spent</text>
              </Show>
            </>
          }
        >
          <box flexDirection="row" gap={1} onMouseDown={toggle}>
            <text fg={theme.text.base}>▶</text>
            <text fg={theme.text.muted} wrapMode="none" truncate>
              {line()}
            </text>
          </box>
        </Show>
      </box>
    </Show>
  )
}

export default Plugin.define({
  id: "opencode.sidebar.context",
  setup(context) {
    context.ui.slot({
      append: "sidebar.content",
      render: (props) => <SidebarContext context={context} sessionID={props.sessionID} />,
    })
  },
})
