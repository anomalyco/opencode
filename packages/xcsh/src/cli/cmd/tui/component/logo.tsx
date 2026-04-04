import { RGBA } from "@opentui/core"
import { For, type JSX } from "solid-js"

const F5_LOGO = [
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
]

// Match xcsh branding colors exactly
const RED = RGBA.fromHex("#ca260a")
const BOLD_WHITE = RGBA.fromHex("#ffffff")

export function Logo() {
  const renderLine = (line: string): JSX.Element[] => {
    const spans: JSX.Element[] = []
    let i = 0
    while (i < line.length) {
      const ch = line[i]!
      let j = i + 1
      while (j < line.length && line[j] === ch) j++
      const len = j - i
      if (ch === "▓") {
        // Dark shade → solid block in red
        spans.push(<span style={{ fg: RED }}>{"█".repeat(len)}</span>)
      } else if (ch === "█") {
        // Full block → bold white F5 text
        spans.push(<span style={{ fg: BOLD_WHITE, bold: true }}>{"█".repeat(len)}</span>)
      } else if (ch === "▒") {
        // Medium shade → keep as ▒ in same red
        spans.push(<span style={{ fg: RED }}>{"▒".repeat(len)}</span>)
      } else if ("()|_".includes(ch)) {
        // Outline chars → same red
        spans.push(<span style={{ fg: RED }}>{line.slice(i, j)}</span>)
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
