import type { useLanguage } from "@/runtime/i18n/language"

export const TIP_INTERVAL_MS = 24 * 60 * 60 * 1000

export const FIRST_TIP_DELAY_MS = 60 * 60 * 1000

type Text = Parameters<ReturnType<typeof useLanguage>["t"]>[0]

export type Tip = {
  id: string
  title: Text
  description: Text
  action?: { label: Text; run: () => void }
  when?: () => boolean
  start?: number
  end?: number
}

export type TipHistory = {
  current: string
  shownAt: number
  dismissed: readonly string[]
  dismissedAt: number
  firstSeen: number
}

/** Array order is priority. Dates are epoch milliseconds; the end is exclusive. */
export function selectTip(tips: readonly Tip[], history: TipHistory, now: number) {
  const eligible = (tip: Tip) =>
    !history.dismissed.includes(tip.id) &&
    (tip.start === undefined || tip.start <= now) &&
    (tip.end === undefined || now < tip.end) &&
    (tip.when?.() ?? true)

  const current = tips.find((tip) => tip.id === history.current && eligible(tip))

  if (current) return current

  const last = Math.max(history.shownAt, history.dismissedAt)

  if (last && now < last + TIP_INTERVAL_MS) return

  if (!last && now < (history.firstSeen || now) + FIRST_TIP_DELAY_MS) return

  return tips.find(eligible)
}
