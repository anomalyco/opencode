import { createMemo, For, Show } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { useTerminalDimensions } from "@opentui/solid"
import {
  type DateRange,
  type UsageRecord,
  dayKey,
  formatCompact,
  formatShortDate,
  rangeBounds,
  tokensPerModelPerDay,
} from "@tui/util/usage-stats"
import { modelColor } from "./palette"
import { displayModel } from "./data"

/** A terminal-friendly stacked vertical-bar chart.
 *
 *  Each column is a day; within a column we split the bar proportionally
 *  by model share. The Y axis shows compact token tick labels. */
export function Chart(props: { records: UsageRecord[]; range: DateRange }) {
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()

  const height = 10

  const days = createMemo(() => buildDaySpine(props.records, props.range))
  const perModelDay = createMemo(() => tokensPerModelPerDay(props.records))
  const modelList = createMemo(() =>
    [...perModelDay()]
      .map(([model, series]) => ({ model, total: series.reduce((s, d) => s + d.total, 0) }))
      .sort((a, b) => b.total - a.total)
      .map((x) => x.model),
  )

  const maxDay = createMemo(() => {
    let max = 0
    for (const day of days()) {
      let total = 0
      for (const [, series] of perModelDay()) {
        const match = series.find((s) => s.day === day)
        if (match) total += match.total
      }
      if (total > max) max = total
    }
    return max
  })

  // Width budget: 6 cols for Y axis label, rest split among day columns.
  const columnWidth = createMemo(() => {
    const available = Math.max(20, dimensions().width - 10 - 2 * 2)
    const count = Math.max(1, days().length)
    return Math.max(1, Math.min(3, Math.floor(available / count)))
  })

  // For every day + model, compute the row height ceiling the bar occupies.
  const columns = createMemo(() => {
    const max = maxDay()
    return days().map((day) => {
      // Rows: from top=0 (brightest) to bottom=height-1. For each row, we
      // identify which model's bar occupies it, if any, for this day.
      const segments: { model: string; count: number }[] = []
      let total = 0
      for (const model of modelList()) {
        const series = perModelDay().get(model)
        const match = series?.find((s) => s.day === day)
        if (!match) continue
        total += match.total
        segments.push({ model, count: match.total })
      }
      if (max <= 0 || total <= 0) {
        return { day, rows: Array<string | undefined>(height).fill(undefined), total: 0 }
      }
      const totalRows = Math.max(1, Math.round((total / max) * height))
      const rows = Array<string | undefined>(height).fill(undefined)
      let filled = 0
      // Fill from bottom up: walk segments in order, assigning rows proportionally.
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i]
        const segRows =
          i === segments.length - 1
            ? totalRows - filled
            : Math.max(0, Math.round((seg.count / total) * totalRows))
        for (let r = 0; r < segRows; r++) {
          const rowIndex = height - 1 - (filled + r)
          if (rowIndex >= 0) rows[rowIndex] = seg.model
        }
        filled += segRows
      }
      return { day, rows, total }
    })
  })

  return (
    <box flexDirection="column">
      <Show
        when={props.records.length > 0 && maxDay() > 0}
        fallback={<text fg={theme.textMuted}>No model usage in this range.</text>}
      >
        <box flexDirection="row">
          {/* Y axis */}
          <box flexShrink={0} width={8} flexDirection="column">
            <For each={Array.from({ length: height }, (_, i) => i)}>
              {(rowIdx) => {
                const tick = () => {
                  const max = maxDay()
                  const isFirst = rowIdx === 0
                  const isMid = rowIdx === Math.floor(height / 2)
                  const isLast = rowIdx === height - 1
                  if (isFirst) return formatCompact(max)
                  if (isMid) return formatCompact(Math.round(max / 2))
                  if (isLast) return "0"
                  return ""
                }
                return (
                  <box flexDirection="row" justifyContent="flex-end" width={7}>
                    <text fg={theme.textMuted} selectable={false}>
                      {tick().padStart(7)}
                    </text>
                  </box>
                )
              }}
            </For>
          </box>

          {/* Plot area: render row-by-row, each row is a sequence of cells across days */}
          <box flexDirection="column">
            <For each={Array.from({ length: height }, (_, i) => i)}>
              {(rowIdx) => (
                <box flexDirection="row">
                  <For each={columns()}>
                    {(col) => {
                      const model = col.rows[rowIdx]
                      if (!model) {
                        return (
                          <box width={columnWidth()}>
                            <text fg={theme.textMuted} selectable={false}>
                              {" ".repeat(columnWidth())}
                            </text>
                          </box>
                        )
                      }
                      const idx = modelList().indexOf(model)
                      const color = modelColor(model, idx < 0 ? 0 : idx)
                      const glyph = "█".repeat(columnWidth())
                      return (
                        <box width={columnWidth()}>
                          <text fg={color} selectable={false}>
                            {glyph}
                          </text>
                        </box>
                      )
                    }}
                  </For>
                </box>
              )}
            </For>

            {/* X axis: show first, middle, last day labels only to avoid clutter */}
            <XAxis days={days()} columnWidth={columnWidth()} />
          </box>
        </box>

        {/* Legend */}
        <box flexDirection="row" paddingLeft={8} paddingTop={1} gap={2}>
          <For each={modelList()}>
            {(model, i) => (
              <box flexDirection="row" gap={1}>
                <text fg={modelColor(model, i())} selectable={false}>
                  ●
                </text>
                <text fg={theme.text}>{displayModel(model)}</text>
              </box>
            )}
          </For>
        </box>
      </Show>
    </box>
  )
}

function XAxis(props: { days: string[]; columnWidth: number }) {
  const { theme } = useTheme()
  const width = () => Math.max(1, props.days.length * props.columnWidth)
  const labels = createMemo(() => {
    if (props.days.length === 0) return ""
    const line = Array<string>(width()).fill(" ")
    const place = (idx: number, text: string) => {
      const center = idx * props.columnWidth
      const start = Math.max(0, Math.min(line.length - text.length, center - Math.floor(text.length / 2)))
      for (let i = 0; i < text.length; i++) line[start + i] = text[i]
    }
    if (props.days.length === 1) {
      place(0, formatShortDate(props.days[0]))
      return line.join("")
    }
    place(0, formatShortDate(props.days[0]))
    const mid = Math.floor(props.days.length / 2)
    place(mid, formatShortDate(props.days[mid]))
    place(props.days.length - 1, formatShortDate(props.days[props.days.length - 1]))
    return line.join("")
  })
  return (
    <box flexDirection="row">
      <text fg={theme.textMuted} selectable={false}>
        {labels()}
      </text>
    </box>
  )
}

/** Build the full list of days in the selected range, including zero-usage days. */
function buildDaySpine(records: UsageRecord[], range: DateRange): string[] {
  if (range === "all") {
    // For all-time, anchor the spine to the records' span; if empty, return [].
    if (records.length === 0) return []
    let min = records[0].timestamp
    let max = records[0].timestamp
    for (const r of records) {
      if (r.timestamp < min) min = r.timestamp
      if (r.timestamp > max) max = r.timestamp
    }
    // Cap to a sane horizon (last 60 days anchored to latest record) to avoid
    // a gigantic chart when the full history stretches back years.
    const earliestAllowed = max - 60 * 24 * 60 * 60 * 1000
    if (min < earliestAllowed) min = earliestAllowed
    return daySpan(min, max)
  }
  const bounds = rangeBounds(range)
  if (!bounds) return []
  return daySpan(bounds.start, bounds.end)
}

function daySpan(startMs: number, endMs: number): string[] {
  const days: string[] = []
  const start = new Date(startMs)
  start.setHours(0, 0, 0, 0)
  const end = new Date(endMs)
  end.setHours(0, 0, 0, 0)
  const endTs = end.getTime()
  let curTs = start.getTime()
  while (curTs <= endTs) {
    days.push(dayKey(curTs))
    const d = new Date(curTs)
    d.setDate(d.getDate() + 1)
    curTs = d.getTime()
  }
  return days
}
