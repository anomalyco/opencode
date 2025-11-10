import type { Component } from "solid-js"
import { For, createMemo } from "solid-js"
import type { TerminalCell } from "./types"

interface TerminalGridProps {
  grid: TerminalCell[][]
  cols: number
  rows: number
}

export const TerminalGrid: Component<TerminalGridProps> = (props) => {
  const flattenedCells = createMemo(() => {
    const cells: Array<TerminalCell & { col: number; row: number }> = []
    for (let row = 0; row < props.rows; row++) {
      for (let col = 0; col < props.cols; col++) {
        const gridRow = props.grid[row]
        if (gridRow) {
          const cell = gridRow[col]
          if (cell) {
            cells.push({
              ...cell,
              col,
              row,
            })
          }
        }
      }
    }
    return cells
  })

  return (
    <div
      style={{
        position: "relative",
        "font-family": '"Berkeley Mono", "JetBrains Mono", monospace',
        "font-size": "16px",
        "line-height": "1.5",
        width: `${props.cols}ch`,
        height: `${props.rows * 1.5}em`,
        background: "#0a0a0a",
        overflow: "hidden",
        "white-space": "pre",
      }}
    >
      <For each={flattenedCells()}>
        {(cell) => (
          <span
            style={{
              position: "absolute",
              left: `${cell.col}ch`,
              top: `${cell.row * 1.5}em`,
              width: "1ch",
              height: "1.5em",
              color: cell.fg,
              background: cell.bg,
              "font-weight": cell.bold ? "bold" : "normal",
              "font-style": cell.italic ? "italic" : "normal",
              "text-decoration": cell.underline ? "underline" : "none",
              display: "inline-block",
            }}
          >
            {cell.char}
          </span>
        )}
      </For>
    </div>
  )
}
