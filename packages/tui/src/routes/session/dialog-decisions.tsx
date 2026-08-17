import { createMemo, onMount, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import type { PermissionDecision } from "@opencode-ai/sdk/v2"
import { useSync } from "../../context/sync"
import { DialogSelect, type DialogSelectOption } from "../../ui/dialog-select"
import { useTheme } from "../../context/theme"
import { useDialog, type DialogContext } from "../../ui/dialog"
import { Locale } from "../../util/locale"

export function DialogDecisions(props: { sessionID: string }) {
  const sync = useSync()
  const dialog = useDialog()
  const { theme } = useTheme()

  onMount(() => {
    dialog.setSize("large")
  })

  const options = createMemo((): DialogSelectOption<string>[] => {
    const decisions = sync.data.decision[props.sessionID] ?? []
    return decisions.toReversed().map((item) => ({
      title: Locale.truncate(`${item.permission}: ${item.patterns[0] ?? ""}`, 80),
      description: `${item.verdict} · ${item.model} · ${String(item.latency_ms)}ms`,
      details: [...(item.reason ? [item.reason] : []), ...item.patterns.slice(1).map((pattern) => `↳ ${pattern}`)],
      footer: Locale.time(Number(item.created_at)),
      gutter: () => {
        if (item.verdict === "allow") return <text fg={theme.success}>✓</text>
        if (item.verdict === "deny") return <text fg={theme.error}>✕</text>
        if (item.verdict === "uncertain") return <text fg={theme.warning}>?</text>
        return <text fg={theme.textMuted}>↩</text>
      },
      value: item.id,
      onSelect: () => DialogDecisionDetail.show(dialog, item),
    }))
  })

  return <DialogSelect title="Auto mode decisions" options={options()} />
}

function DialogDecisionDetail(props: { item: PermissionDecision }) {
  const dialog = useDialog()
  const { theme } = useTheme()

  onMount(() => {
    dialog.setSize("large")
  })

  const item = () => props.item
  const fields = () =>
    [
      ["verdict", item().verdict],
      ["model", item().model],
      ["permission", item().permission],
      ["patterns", item().patterns.join(", ")],
      ["latency", `${String(item().latency_ms)}ms`],
      ["created", new Date(Number(item().created_at)).toISOString()],
    ] as const

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} flexDirection="column">
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Decision detail
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <scrollbox flexGrow={1} flexShrink={1}>
        <box flexDirection="column">
          {fields().map(([label, value]) => (
            <box flexDirection="row" gap={1}>
              <text fg={theme.textMuted}>{label}:</text>
              <text fg={theme.text}>{value}</text>
            </box>
          ))}
          <Show when={item().reason}>
            <box flexDirection="row" gap={1}>
              <text fg={theme.textMuted}>reason:</text>
              <text fg={theme.text}>{item().reason}</text>
            </box>
          </Show>
        </box>
      </scrollbox>
    </box>
  )
}

DialogDecisionDetail.show = (dialog: DialogContext, item: PermissionDecision) => {
  dialog.replace(() => <DialogDecisionDetail item={item} />)
}
