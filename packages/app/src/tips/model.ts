import { Schema } from "effect"
import { createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { Persistence } from "@/runtime/persistence/schema"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { selectTip, TIP_INTERVAL_MS, type Tip } from "./queue"

const History = Persistence.struct({
  current: Schema.String,
  shownAt: Schema.Finite,
  dismissed: Persistence.array(Schema.String),
  dismissedAt: Schema.Finite,
})

export function createTipQueue(tips: readonly Tip[], ready: () => boolean, providerDismissal: () => number) {
  const [history, setHistory, , loaded] = persisted({ ...Persist.global("tips.queue"), sync: true }, History, {
    current: "",
    shownAt: 0,
    dismissed: [],
    dismissedAt: 0,
  })
  const [tick, setTick] = createSignal(0)
  const tip = createMemo(() => {
    if (!loaded() || !ready()) return
    tick()
    const legacy = providerDismissal()
    return selectTip(
      tips,
      legacy
        ? {
            ...history,
            dismissed: [...history.dismissed, "provider"],
            dismissedAt: Math.max(history.dismissedAt, legacy),
          }
        : history,
      Date.now(),
    )
  })

  createEffect(() => {
    const current = tip()
    if (current && history.current !== current.id) setHistory({ current: current.id, shownAt: Date.now() })
  })

  createEffect(() => {
    if (!loaded() || !ready()) return
    tick()
    const now = Date.now()
    const next = Math.min(
      ...[
        Math.max(history.shownAt, history.dismissedAt, providerDismissal()) + TIP_INTERVAL_MS,
        ...tips.flatMap((tip) => [tip.start ?? 0, tip.end ?? 0]),
      ].filter((time) => time > now),
    )
    if (!Number.isFinite(next)) return
    const timer = setTimeout(() => setTick((value) => value + 1), Math.min(next - now, 2 ** 31 - 1))
    onCleanup(() => clearTimeout(timer))
  })

  return {
    tip,
    dismiss() {
      const current = tip()
      if (current) setHistory({ current: "", dismissed: [...history.dismissed, current.id], dismissedAt: Date.now() })
    },
  }
}
