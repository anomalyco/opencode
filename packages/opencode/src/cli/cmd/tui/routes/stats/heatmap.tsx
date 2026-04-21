import { createMemo, For } from "solid-js"
import { RGBA } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { useTheme } from "@tui/context/theme"
import { type UsageRecord, heatmapGrid, heatmapLevel } from "@tui/util/usage-stats"

const ROW_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""]

/** GitHub-style contribution heatmap. Cells are rendered as single double-cells
 *  (two spaces with background color) to preserve aspect ratio in a terminal. */
export function Heatmap(props: { records: UsageRecord[] }) {
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()

  const weeksToShow = createMemo(() => {
    // Leave ~10 cells of margin for the left labels/spacing.
    const available = Math.max(10, Math.floor((dimensions().width - 14) / 3))
    return Math.min(53, Math.max(12, available))
  })

  const grid = createMemo(() => heatmapGrid(props.records, Date.now(), weeksToShow()))

  const intensity = (level: number): RGBA => {
    if (level === 0) return RGBA.fromInts(30, 30, 30)
    const steps: [number, number, number][] = [
      [0, 0, 0],
      [60, 40, 20],
      [120, 80, 40],
      [200, 130, 60],
      [250, 178, 131],
    ]
    const [r, g, b] = steps[level] ?? steps[4]
    return RGBA.fromInts(r, g, b)
  }

  const cell = (value: number, max: number) => {
    const level = heatmapLevel(value, max)
    if (level === 0) {
      return (
        <text fg={theme.textMuted} selectable={false}>
          ·{" "}
        </text>
      )
    }
    return (
      <text bg={intensity(level)} selectable={false}>
        {"  "}
      </text>
    )
  }

  return (
    <box flexDirection="column" flexShrink={0}>
      {/* Month labels */}
      <box flexDirection="row" paddingLeft={5}>
        <For each={buildMonthLine(grid().weeks.length, grid().monthLabels)}>
          {(char) => (
            <text fg={theme.textMuted} selectable={false}>
              {char}
            </text>
          )}
        </For>
      </box>

      {/* Rows: Sun..Sat. Only Mon/Wed/Fri are labeled to reduce clutter. */}
      <For each={[0, 1, 2, 3, 4, 5, 6]}>
        {(row) => (
          <box flexDirection="row">
            <box flexShrink={0} width={4} paddingRight={1}>
              <text fg={theme.textMuted} selectable={false}>
                {ROW_LABELS[row]}
              </text>
            </box>
            <box flexDirection="row">
              <For each={grid().weeks}>
                {(col) => {
                  const c = col[row]
                  return (
                    <box marginRight={1}>
                      {c?.day ? cell(c.total, grid().max) : <text selectable={false}>{"  "}</text>}
                    </box>
                  )
                }}
              </For>
            </box>
          </box>
        )}
      </For>

      {/* Legend */}
      <box flexDirection="row" paddingLeft={5} paddingTop={1} gap={1}>
        <text fg={theme.textMuted}>Less</text>
        <For each={[0, 1, 2, 3, 4]}>
          {(level) => {
            if (level === 0)
              return (
                <text fg={theme.textMuted} selectable={false}>
                  ·{" "}
                </text>
              )
            return (
              <box marginRight={0}>
                <text bg={intensity(level)} selectable={false}>
                  {"  "}
                </text>
              </box>
            )
          }}
        </For>
        <text fg={theme.textMuted}>More</text>
      </box>
    </box>
  )
}

/**
 * Given the week count and month labels, produce a string per column so
 * that month names land at the right position in the grid. Each cell is
 * 3 columns wide (2 block chars + 1 space separator).
 */
function buildMonthLine(weekCount: number, labels: { label: string; week: number }[]): string[] {
  const width = 3 // per cell
  const line = Array(weekCount * width).fill(" ")
  for (const { label, week } of labels) {
    const start = week * width
    for (let i = 0; i < label.length && start + i < line.length; i++) {
      line[start + i] = label[i]
    }
  }
  return line
}
