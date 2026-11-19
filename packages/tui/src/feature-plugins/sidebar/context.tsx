import { Plugin } from "@opencode/plugin/tui"
import { createMemo, Show } from "solid-js"
import { costEstimate, contextUsage } from "../../util/session"
import { useCostEstimate } from "../../config"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

export function SidebarContext(props: { context: Plugin.Context; sessionID: string }) {
  const theme = props.context.theme
  const enabled = useCostEstimate()
  const msg = createMemo(() => props.context.data.session.message.list(props.sessionID))
  const session = createMemo(() => props.context.data.session.get(props.sessionID))
  const cost = createMemo(() => props.context.data.session.cost(props.sessionID))

  const state = createMemo(() =>
    contextUsage(msg(), props.context.data.location.model.list(session()?.location), session()?.revert?.messageID),
  )

  const estimate = createMemo(() => {
    if (cost() > 0 || !enabled()) return 0
    const info = session()
    if (!info) return 0
    const data = props.context.data.session
    return costEstimate(
      info.parentID
        ? [info]
        : data
            .family(props.sessionID)
            .map((id) => data.get(id))
            .filter((info) => info !== undefined),
      props.context.data.location.model.list(info.location),
      (id) => data.message.list(id),
    )
  })

  const spent = createMemo(() => {
    if (cost() > 0) return `${money.format(cost())} spent`
    // The tilde marks the catalog-price figure as an estimate; the recorded cost stays authoritative.
    const value = estimate()
    return value !== undefined && value > 0 ? `≈ ${value < 0.01 ? "<$0.01" : money.format(value)} spent` : undefined
  })

  return (
    <Show when={state() || spent()}>
      <box>
        <text fg={theme.text.base}>
          <b>Context</b>
        </text>
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
        <Show when={spent()}>
          <text fg={theme.text.muted}>{spent()}</text>
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
