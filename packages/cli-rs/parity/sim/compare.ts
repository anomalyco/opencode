// P-TUI comparison (docs/H.5.md): captures become H.1 cell fixtures, masked with H.2's `applyMasks`, and compared
// cell by cell as `opencode_parity::compare` does. Requests follow H.2's P-REQ rule.
import type { Frontend } from "@opencode/protocol/simulation"
import type { Fixture } from "../lib/cells"
import { normalize } from "../cli/client"
import type { Logged } from "./proxy"

// The cells listed in a report before it summarizes the rest, as in crates/parity.
const REPORT_CELLS = 40

const segmenter = new Intl.Segmenter()

// One symbol per cell, the trailing cells of a wide grapheme "", as the H.1 format keeps them. Captures carry no
// palette intent, so a color is plain `#rrggbbaa`.
export function toFixture(frame: Frontend.CapturedFrame): Fixture {
  const color = (rgba: Frontend.Color) => "#" + rgba.map((part) => part.toString(16).padStart(2, "0")).join("")
  const styles = new Map<string, number>()
  const rows = frame.lines.map((line) => {
    const cells = line.spans.flatMap((span) => {
      const style = `${color(span.fg)} ${color(span.bg)} ${span.attributes & 0xff}`
      const symbols = [...segmenter.segment(span.text)].flatMap(({ segment }) => [
        segment,
        ...Array<string>(Math.max(0, Bun.stringWidth(segment) - 1)).fill(""),
      ])
      return Array.from({ length: span.width }, (_, index) => ({ symbol: symbols[index] ?? " ", style }))
    })
    return Array.from({ length: frame.cols }, (_, x) => cells[x] ?? { symbol: " ", style: "" })
  })
  return {
    width: frame.cols,
    height: frame.rows,
    rows: rows.map((row) => {
      const symbols = row.map((cell) => cell.symbol)
      return symbols.every((symbol) => [...symbol].length === 1) ? symbols.join("") : symbols
    }),
    runs: rows.map((row) =>
      row.reduce<[number, number][]>((runs, cell) => {
        const style = styles.get(cell.style) ?? styles.set(cell.style, styles.size).get(cell.style)!
        const last = runs.at(-1)
        if (last && last[0] === style) last[1]++
        else runs.push([style, 1])
        return runs
      }, []),
    ),
    styles: [...styles.keys()],
  }
}

export function text(fixture: Fixture) {
  return cells(fixture)
    .map((row) =>
      row
        .map((cell) => cell.symbol)
        .join("")
        .trimEnd(),
    )
    .join("\n")
}

export type Comparison = { equal: boolean; differences: number; report: string }

// Cells differ when their symbol, colors, or attributes differ. The report has the shape of crates/parity's:
// each differing row from both sides with markers, then the first differing cells.
export function compareFixtures(expected: Fixture, actual: Fixture): Comparison {
  if (expected.width !== actual.width || expected.height !== actual.height)
    return {
      equal: false,
      differences: expected.width * expected.height,
      report: `size ${expected.width}x${expected.height} expected, ${actual.width}x${actual.height} actual`,
    }
  const a = cells(expected)
  const b = cells(actual)
  const differences = a.flatMap((row, y) =>
    row.flatMap((cell, x) =>
      cell.symbol === b[y][x].symbol && cell.style === b[y][x].style ? [] : [{ x, y, want: cell, got: b[y][x] }],
    ),
  )
  if (differences.length === 0)
    return { equal: true, differences: 0, report: `all ${expected.width * expected.height} cells equal` }
  const rows = [...new Set(differences.map((cell) => cell.y))]
  const lines = [
    `${differences.length} of ${expected.width * expected.height} cells differ (${expected.width}x${expected.height})`,
    ...rows.flatMap((y) => {
      const marker = Array.from({ length: expected.width }, (_, x) =>
        differences.some((cell) => cell.x === x && cell.y === y) ? "^" : " ",
      )
      return [
        `row ${y}`,
        `  expected |${a[y].map((cell) => cell.symbol).join("")}|`,
        `  actual   |${b[y].map((cell) => cell.symbol).join("")}|`,
        `            ${marker.join("").trimEnd()}`,
      ]
    }),
    ...differences.slice(0, REPORT_CELLS).map(({ x, y, want, got }) => {
      const fields = [
        ...(want.symbol === got.symbol
          ? []
          : [`symbol ${JSON.stringify(want.symbol)} -> ${JSON.stringify(got.symbol)}`]),
        ...(want.style === got.style ? [] : [`style ${want.style} -> ${got.style}`]),
      ]
      return `(${x},${y}) ${fields.join(", ")}`
    }),
    ...(differences.length > REPORT_CELLS ? [`... and ${differences.length - REPORT_CELLS} more cells`] : []),
  ]
  return { equal: false, differences: differences.length, report: lines.join("\n") }
}

function cells(fixture: Fixture) {
  return fixture.rows.map((row, y) => {
    const symbols = typeof row === "string" ? [...row] : row
    const styles = fixture.runs[y].flatMap(([style, count]) => Array<string>(count).fill(fixture.styles[style]))
    return symbols.map((symbol, x) => ({ symbol, style: styles[x] }))
  })
}

// Any other server-minted ID, such as `sh_1abfe888b001Ly5UDI8NNG6vOi` (crates/parity `minted`: a lowercase prefix
// and at least 20 letters and digits).
const minted = /\b([a-z]+)_[A-Za-z0-9]{20,}\b/g

// H.2's `isRead`: a GET, or a plugin RPC named `get`.
export function isRead(method: string, path: string) {
  return method === "GET" || /^\/api\/rpc\/[^/]+\/get$/.test(path)
}

export type RequestComparison = {
  equal: boolean
  writes: { a: string[]; b: string[] }
  onlyA: string[]
  onlyB: string[]
}

// Writes must match in order after the normalizers; reads one side sent and the other did not are listed only.
export function compareRequests(a: Logged[], b: Logged[], root: string): RequestComparison {
  // A live server stamps real times, so epoch milliseconds are normalized too (plan 7.5, timestamps).
  // Bodies are compared as JSON values, so key order does not count.
  const line = (entry: Logged) =>
    normalize(
      `${entry.method} ${entry.path}${entry.body === undefined ? "" : " " + JSON.stringify(sorted(entry.body))}`,
      { root },
    )
      .replace(minted, "<$1>")
      .replace(/\b1\d{12}\b/g, "<epoch>")
  const writes = (log: Logged[]) => log.filter((entry) => !isRead(entry.method, entry.path)).map(line)
  const reads = (log: Logged[]) => [
    ...new Set(
      log
        .filter((entry) => isRead(entry.method, entry.path))
        .map((entry) => normalize(`${entry.method} ${entry.path}`, { root }).replace(minted, "<$1>")),
    ),
  ]
  const readsA = reads(a)
  const readsB = reads(b)
  const result = {
    writes: { a: writes(a), b: writes(b) },
    onlyA: readsA.filter((read) => !readsB.includes(read)),
    onlyB: readsB.filter((read) => !readsA.includes(read)),
  }
  return { equal: JSON.stringify(result.writes.a) === JSON.stringify(result.writes.b), ...result }
}

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted)
  if (typeof value !== "object" || value === null) return value
  return Object.fromEntries(
    Object.entries(value)
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, sorted(item)]),
  )
}
