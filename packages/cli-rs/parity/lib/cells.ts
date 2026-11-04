// The P-COMP cell fixture format, shared with crates/parity/src/fixture.rs. A fixture is JSON:
//
//   { "width": 40, "height": 8,
//     "rows": ["╭──…", ["a", "界", "", "b", …], …],
//     "styles": ["#eeeeeeff #0a0a0aff 1", …],
//     "runs": [[[0, 12], [3, 28]], …] }
//
// `rows` holds one entry per row: a string when every cell holds exactly one code point, else an array
// with one symbol per cell (the trailing cells of a wide grapheme are ""). `styles` lists each distinct
// "fg bg attributes" once; `runs` holds per row the [style index, cell count] runs covering the row.
// A color is `#rrggbbaa`, followed by `@<slot>` for a palette color or `@default` for the terminal
// default; the RGBA part is the fallback snapshot native code keeps for those.
import type { OptimizedBuffer } from "@opentui/core"

export type Fixture = {
  width: number
  height: number
  rows: (string | string[])[]
  styles: string[]
  runs: [number, number][][]
}

type Planes = { width: number; height: number; fg: Uint16Array; bg: Uint16Array; attributes: Uint32Array }

// The native color word layout (opentui.h): RGBA bytes in the low bytes, the palette slot in the high byte
// of word 0, and the intent (0 RGB, 1 indexed, 2 default) in the high byte of word 1.
const META_SHIFT = 8

// Reads the cells of a buffer with the same native calls opentui-rust's Capture uses
// (ot_buffer_lease_write_resolved_chars with per-cell lengths). OpenTUI keeps this reader private; its
// public getSpanLines merges cells into spans, which loses wide-grapheme cell boundaries.
export function readCells(buffer: OptimizedBuffer): Fixture {
  const reader = buffer as unknown as {
    withResolvedChars<T>(
      options: { addLineBreaks: boolean; cellLengths: boolean },
      callback: (bytes: Uint8Array, cells: Planes, lengths: Uint8Array) => T,
    ): T
  }
  return reader.withResolvedChars({ addLineBreaks: false, cellLengths: true }, (bytes, cells, lengths) => {
    const decoder = new TextDecoder("utf-8", { ignoreBOM: true })
    const styles = new Map<string, number>()
    const rows: Fixture["rows"] = []
    const runs: Fixture["runs"] = []
    let offset = 0
    for (let y = 0; y < cells.height; y++) {
      const symbols: string[] = []
      const row: [number, number][] = []
      for (let x = 0; x < cells.width; x++) {
        const index = y * cells.width + x
        const end = offset + lengths[index]
        symbols.push(decoder.decode(bytes.subarray(offset, end)))
        offset = end
        const key = `${color(cells.fg, index)} ${color(cells.bg, index)} ${cells.attributes[index] & 0xff}`
        const style = styles.get(key) ?? styles.set(key, styles.size).get(key)!
        const last = row.at(-1)
        if (last && last[0] === style) last[1]++
        else row.push([style, 1])
      }
      rows.push(symbols.every((symbol) => [...symbol].length === 1) ? symbols.join("") : symbols)
      runs.push(row)
    }
    return { width: cells.width, height: cells.height, rows, styles: [...styles.keys()], runs }
  })
}

export async function writeFixture(path: string, fixture: Fixture) {
  // One row per line keeps fixture diffs readable.
  const rows = (key: "rows" | "runs") => fixture[key].map((row) => `    ${JSON.stringify(row)}`).join(",\n")
  const text = [
    "{",
    `  "width": ${fixture.width},`,
    `  "height": ${fixture.height},`,
    `  "rows": [\n${rows("rows")}\n  ],`,
    `  "styles": ${JSON.stringify(fixture.styles, null, 2).replace(/\n/g, "\n  ")},`,
    `  "runs": [\n${rows("runs")}\n  ]`,
    "}",
    "",
  ].join("\n")
  await Bun.write(path, text)
}

function color(plane: Uint16Array, index: number) {
  const words = plane.subarray(index * 4, index * 4 + 4)
  const rgba = Array.from(words, (word) => (word & 0xff).toString(16).padStart(2, "0")).join("")
  const intent = words[1] >> META_SHIFT
  if (intent === 1) return `#${rgba}@${words[0] >> META_SHIFT}`
  if (intent === 2) return `#${rgba}@default`
  return `#${rgba}`
}
