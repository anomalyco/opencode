import { RGBA } from "@opentui/core"
import { For, type JSX } from "solid-js"
import { useTheme } from "@tui/context/theme"

const F5_LOGO = [
  "         ──────────────────────────",
  "                   ________",
  "              (▒▒▒▒▓▓▓▓▓▓▓▓▒▒▒▒)",
  "         (▒▒▒▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▒▒▒)",
  "      (▒▒▓▓▓▓██████████▓▓▓▓█████████████)",
  "    (▒▓▓▓▓██████▒▒▒▒▒███▓▓██████████████▒)",
  "   (▒▓▓▓▓██████▒▓▓▓▓▓▒▒▒▓██▒▒▒▒▒▒▒▒▒▒▒▒▒▓▒)",
  "  (▒▓▓▓▓▓██████▓▓▓▓▓▓▓▓▓██▒▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▒)",
  " (▒▓▓███████████████▓▓▓▓█████████████▓▓▓▓▓▓▒)",
  "(▒▓▓▓▒▒▒███████▒▒▒▒▒▓▓▓████████████████▓▓▓▓▓▒)",
  "|▒▓▓▓▓▓▓▒██████▓▓▓▓▓▓▓████████████████████▓▓▒|",
  "|▒▓▓▓▓▓▓▓██████▓▓▓▓▓▓▓▒▒▒▒▒▒▒▒▒▒▒██████████▓▒|",
  "(▒▓▓▓▓▓▓▓██████▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▒▒████████▒▒)",
  " (▒▓▓▓▓▓▓██████▓▓▓▓▓▓▓███▓▓▓▓▓▓▓▓▓▓▒▒▒████▒▒)",
  "  (▒▓▓▓▓▓██████▓▓▓▓▓▓█████▓▓▓▓▓▓▓▓▓▓▓▓███▒▒)",
  "   (▒▒██████████▓▓▓▓▓▒██████▓▓▓▓▓▓▓▓███▒▒▒)",
  "    (▒▒▒▒▒██████████▓▓▒▒█████████████▒▒▓▒)",
  "      (▒▓▓▒▒▒▒▒▒▒▒▒▒▓▓▓▓▒▒▒▒▒▒▒▒▒▒▒▒▒▓▒)",
  "         (▒▒▒▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▒▒▒)",
  "              (▒▒▒▒▓▓▓▓▓▓▓▓▒▒▒▒)",
  "         ──────────────────────────",
]

const RED = RGBA.fromHex("#e4002b")
const RED_DIM = RGBA.fromHex("#a70020")
const RED_OUTLINE = RGBA.fromHex("#5a1020")

export function Logo() {
  const { theme } = useTheme()

  const renderLine = (line: string): JSX.Element[] => {
    const spans: JSX.Element[] = []
    let i = 0
    while (i < line.length) {
      const ch = line[i]!
      let j = i + 1
      while (j < line.length && line[j] === ch) j++
      const len = j - i
      if (ch === "▓") {
        spans.push(<span style={{ fg: RED }}>{"█".repeat(len)}</span>)
      } else if (ch === "█") {
        spans.push(<span style={{ fg: theme.text }}>{"█".repeat(len)}</span>)
      } else if (ch === "▒") {
        spans.push(<span style={{ fg: RED_DIM }}>{"█".repeat(len)}</span>)
      } else if ("()|_─".includes(ch)) {
        spans.push(<span style={{ fg: RED_OUTLINE }}>{line.slice(i, j)}</span>)
      } else {
        spans.push(<span>{line.slice(i, j)}</span>)
      }
      i = j
    }
    return spans
  }

  return (
    <box alignSelf="center">
      <For each={F5_LOGO}>{(line) => <text selectable={false}>{renderLine(line)}</text>}</For>
    </box>
  )
}
