import { For } from "solid-js"
import { useTheme } from "../../context/theme"

export interface TableColumn {
  key: string
  header: string
  width: number
  align?: "left" | "right"
}

function padCell(text: string, width: number, align: "left" | "right" = "left") {
  const str = String(text ?? "").slice(0, width)
  const pad = " ".repeat(Math.max(0, width - str.length))
  return align === "right" ? pad + str : str + pad
}

export function InkTable(props: {
  columns: TableColumn[]
  rows: Record<string, string | number>[]
  caption?: string
}) {
  const { theme } = useTheme()
  const sep = () =>
    props.columns.map((c) => "─".repeat(c.width + 2)).join("┼")

  return (
    <box flexDirection="column">
      {/* Caption */}
      {props.caption && (
        <text fg={theme.textMuted}>
          <b>{props.caption}</b>
        </text>
      )}

      {/* Header */}
      <box
        flexDirection="row"
        backgroundColor={theme.backgroundElement}
        paddingTop={0}
        paddingBottom={0}
      >
        <For each={props.columns}>
          {(col) => (
            <text fg={theme.accent} paddingLeft={1} paddingRight={1}>
              <b>{padCell(col.header, col.width, col.align)}</b>
            </text>
          )}
        </For>
      </box>

      {/* Separator */}
      <text fg={theme.border}>{"┼" + sep() + "┼"}</text>

      {/* Rows */}
      <For each={props.rows}>
        {(row, i) => (
          <box
            flexDirection="row"
            backgroundColor={i() % 2 === 0 ? theme.backgroundPanel : theme.background}
          >
            <For each={props.columns}>
              {(col) => (
                <text fg={theme.text} paddingLeft={1} paddingRight={1}>
                  {padCell(String(row[col.key] ?? ""), col.width, col.align)}
                </text>
              )}
            </For>
          </box>
        )}
      </For>
    </box>
  )
}
