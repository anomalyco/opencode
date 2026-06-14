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

function toneColor(theme: ReturnType<typeof useTheme>["theme"], tone: HealthTone) {
  return tone === "error" ? theme.error : tone === "warning" ? theme.warning : theme.textMuted
}

/**
 * Presentational spend-vs-cap readout. Pure (theme-only) so it can be rendered
 * and snapshot-tested without the sync/route contexts. Returns nothing when no
 * cap is configured.
 */
export function BudgetReadout(props: { cost: number; cap: number | undefined; warnAt?: number[] }) {
  const { theme } = useTheme()
  const view = createMemo(() => {
    const result = budgetView(props.cost, props.cap, props.warnAt)
    if (!result) return undefined
    return { ...result, cost: props.cost, cap: props.cap! }
  })

  return (
    <Show when={view()}>
      {(v) => (
        <text fg={toneColor(theme, v().tone)}>
          {money.format(v().cost)}/{money.format(v().cap)} ({Math.round(v().pct * 100)}%)
        </text>
      )}
    </Show>
  )
}

export function BudgetStatus() {
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

  const cost = createMemo(() => {
    const id = activeSessionID()
    if (!id) return undefined
    return sync.session.get(id)?.cost ?? 0
  })

  return (
    <Show when={cost() !== undefined}>
      <BudgetReadout cost={cost()!} cap={budget()?.usd} warnAt={budget()?.warn_at} />
    </Show>
  )
}
