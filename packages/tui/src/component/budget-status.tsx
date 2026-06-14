import { createMemo, Show } from "solid-js"
import { useSync } from "../context/sync"
import { useTheme } from "../context/theme"
import { useRoute } from "../context/route"
import { budgetView, type HealthTone } from "../util/budget"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

type BudgetConfig = {
  usd?: number
  warn_at?: number[]
}

export function BudgetStatus() {
  const { theme } = useTheme()
  const sync = useSync()
  const route = useRoute()

  const activeSessionID = createMemo(() => {
    if (route.data.type !== "session") return undefined
    return (route.data as { sessionID: string }).sessionID
  })

  // `experimental.budget` is part of the server config but not yet surfaced in
  // the generated SDK Config type, so read it through a narrow cast.
  const budget = createMemo<BudgetConfig | undefined>(() => {
    const experimental = sync.data.config.experimental as { budget?: BudgetConfig } | undefined
    return experimental?.budget
  })

  const view = createMemo(() => {
    const id = activeSessionID()
    if (!id) return undefined
    const cap = budget()?.usd
    if (!cap) return undefined
    const cost = sync.session.get(id)?.cost ?? 0
    const result = budgetView(cost, cap, budget()?.warn_at)
    if (!result) return undefined
    return { ...result, cost, cap }
  })

  const color = (tone: HealthTone) =>
    tone === "error" ? theme.error : tone === "warning" ? theme.warning : theme.textMuted

  return (
    <Show when={view()}>
      {(v) => (
        <text fg={color(v().tone)}>
          {money.format(v().cost)}/{money.format(v().cap)} ({Math.round(v().pct * 100)}%)
        </text>
      )}
    </Show>
  )
}
