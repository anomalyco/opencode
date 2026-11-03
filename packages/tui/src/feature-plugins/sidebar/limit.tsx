import { Plugin } from "@opencode/plugin/tui"
import { createMemo, Show } from "solid-js"
import { useUsageLimits } from "../../component/usage"
import { useLocal } from "../../context/local"
import { formatDollars, usageLevel } from "../../util/usage-limits"
import { useLanguage } from "../../context/language"

/** What the workspace's limits leave for the selected model; hidden when no limit applies to it. */
export function SidebarLimit(props: { context: Plugin.Context }) {
  const language = useLanguage()
  const theme = props.context.theme
  const local = useLocal()
  const limits = useUsageLimits()
  const state = createMemo(() => {
    const selected = local.model.current()
    const model = limits
      .models()
      .find((item) => item.providerID === selected?.providerID && item.id === selected?.modelID)
    const usage = model && limits.usage(model)
    if (!model || !usage) return
    const level = usageLevel(usage, model)
    return { left: usage.left, danger: level === "out" || level === "reached" }
  })

  return (
    <Show when={state()}>
      {(value) => (
        <box>
          <text fg={theme.text.base}>
            <b>{language.t("tui.interface.limit")}</b>
          </text>
          <text fg={value().danger ? theme.text.feedback.error.base : theme.text.muted}>
            {language.t("tui.usage.left", { amount: formatDollars(value().left, language) })}
          </text>
        </box>
      )}
    </Show>
  )
}

export default Plugin.define({
  id: "opencode.sidebar.limit",
  setup(context) {
    context.ui.slot({
      append: "sidebar.content",
      render: () => <SidebarLimit context={context} />,
    })
  },
})
