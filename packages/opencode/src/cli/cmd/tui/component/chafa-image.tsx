import { execSync } from "child_process"
import { RGBA } from "@opentui/core"
import { For, createMemo } from "solid-js"

interface ColoredChar {
  char: string
  fg: RGBA | undefined
}

type ImageRow = ColoredChar[]

function parseChafaAnsi(ansi: string): ImageRow[] {
  const rows: ImageRow[] = []
  // Split by newlines, filter out cursor hide/show sequences
  const lines = ansi
    .replace(/\x1b\[\?25[lh]/g, "")
    .split("\n")
    .filter((l) => l.length > 0)

  for (const line of lines) {
    const row: ColoredChar[] = []
    let currentFg: RGBA | undefined = undefined
    let i = 0

    while (i < line.length) {
      // ANSI escape sequence
      if (line[i] === "\x1b" && line[i + 1] === "[") {
        const end = line.indexOf("m", i)
        if (end === -1) {
          i++
          continue
        }
        const seq = line.slice(i + 2, end)

        if (seq === "0" || seq === "39") {
          currentFg = undefined
        } else if (seq === "7") {
          // reverse video - ignore for simplicity
        } else if (seq.startsWith("38;2;")) {
          const parts = seq.slice(5).split(";")
          if (parts.length >= 3) {
            currentFg = new RGBA(parseInt(parts[0]), parseInt(parts[1]), parseInt(parts[2]), 255)
          }
        }

        i = end + 1
        continue
      }

      row.push({ char: line[i], fg: currentFg })
      i++
    }

    if (row.length > 0) {
      rows.push(row)
    }
  }

  return rows
}

function groupSegments(row: ImageRow): Array<{ text: string; fg: RGBA | undefined }> {
  const segments: Array<{ text: string; fg: RGBA | undefined }> = []
  let current = { text: "", fg: row[0]?.fg }

  for (const ch of row) {
    const sameFg = ch.fg === current.fg || (ch.fg && current.fg && ch.fg.r === current.fg.r && ch.fg.g === current.fg.g && ch.fg.b === current.fg.b)
    if (sameFg) {
      current.text += ch.char
    } else {
      if (current.text) segments.push(current)
      current = { text: ch.char, fg: ch.fg }
    }
  }
  if (current.text) segments.push(current)
  return segments
}

export function ChafaImage(props: {
  path: string
  width?: number
  height?: number
  fallbackFg?: RGBA
}) {
  const rows = createMemo(() => {
    try {
      const w = props.width ?? 28
      const h = props.height ?? 4
      const output = execSync(`chafa --format=symbols --size=${w}x${h} --fg-only "${props.path}"`, {
        encoding: "utf-8",
        timeout: 3000,
      })
      return parseChafaAnsi(output)
    } catch {
      return []
    }
  })

  return (
    <box>
      <For each={rows()}>
        {(row) => (
          <box flexDirection="row">
            <For each={groupSegments(row)}>
              {(segment) => (
                <text fg={segment.fg ?? props.fallbackFg}>{segment.text}</text>
              )}
            </For>
          </box>
        )}
      </For>
    </box>
  )
}
