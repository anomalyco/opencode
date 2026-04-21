import {
  type DateRange,
  type UsageRecord,
  activeDays,
  compareToWork,
  distinctSessions,
  favoriteModel,
  formatCompact,
  formatDuration,
  formatMultiplier,
  formatPct,
  formatShortDate,
  longestSessionMs,
  mostActiveDay,
  perModelShare,
  streaks,
  totalTokens,
} from "@tui/util/usage-stats"
import { displayModel } from "./data"

const RANGE_LABELS: Record<DateRange, string> = {
  all: "All time",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
}

/** Plain-text digest of the currently visible stats, suitable for the clipboard. */
export function summarizeStats(input: { range: DateRange; sub: "overview" | "models"; records: UsageRecord[] }): string {
  const { range, sub, records } = input
  const total = totalTokens(records)
  const s = streaks(records)
  const days = activeDays(records)
  const most = mostActiveDay(records)
  const fav = favoriteModel(records)
  const longest = longestSessionMs(records)
  const cmp = compareToWork(total)
  const perModel = perModelShare(records)

  const header = `opencode usage — ${RANGE_LABELS[range]}`
  const overview = [
    `Total tokens     ${formatCompact(total)}`,
    `Favorite model   ${fav ? displayModel(fav) : "—"}`,
    `Sessions         ${distinctSessions(records)}`,
    `Active days      ${days.length}`,
    `Most active day  ${most ? `${formatShortDate(most.day)} (${formatCompact(most.total)})` : "—"}`,
    `Longest session  ${formatDuration(longest)}`,
    `Longest streak   ${s.longest}d`,
    `Current streak   ${s.current}d`,
  ]
  const compare = cmp ? [`~${formatMultiplier(cmp.multiplier)} more tokens than ${cmp.name}`] : []

  const models = perModel.map(
    (m) =>
      `  ${displayModel(m.model).padEnd(28)} ${formatPct(m.share).padStart(7)}  ` +
      `in ${formatCompact(m.input)} / out ${formatCompact(m.output)}`,
  )
  const modelsBlock = models.length > 0 ? ["", "Models:", ...models] : []

  const lines = [header, "-".repeat(header.length), ...overview, ...compare]
  if (sub === "models" || models.length > 0) lines.push(...modelsBlock)
  return lines.join("\n")
}
