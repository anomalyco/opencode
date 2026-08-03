import { createMemo, onMount } from "solid-js"
import { useSync } from "../../context/sync"
import { DialogSelect, type DialogSelectOption } from "../../ui/dialog-select"
import { useTheme } from "../../context/theme"
import { useDialog } from "../../ui/dialog"
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
      onSelect: () => {},
    }))
  })

  return <DialogSelect title="Auto mode decisions" options={options()} />
}
