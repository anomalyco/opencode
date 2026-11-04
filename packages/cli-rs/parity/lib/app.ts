// P-APP scenarios (docs/H.2.md): one file per scenario, `parity/scenarios/<step>/<name>.app.ts`, with
// `export default defineApp({...})`. parity/app/scenarios.test.tsx records each one through the TS TUI;
// crates/tui/tests/app.rs replays the recording through the Rust TUI.
import type { Fixture } from "./cells"
import type { Route } from "./fake-server"

export type { Route }

export type Mask = ({ x: number; y: number; width: number; height: number } | { line: string }) & {
  reason: string
}

export type Step =
  // Shortcuts in opentui-rust's syntax: "enter", "ctrl+x", "a".
  | { keys: string[] }
  // Text, one key press per character.
  | { type: string }
  // A left press and release at a cell, `[x, y]`.
  | { click: [number, number] }
  // One `/api/event` event.
  | { event: Record<string, unknown> }
  // A left-button drag from one cell to another, `[[x, y], [x, y]]`; TS moves in five steps, Rust one cell at a
  // time, and both end with the release on the target cell.
  | { drag: [[number, number], [number, number]] }
  | {
      checkpoint: string
      // Text the TS frame contains once it is ready.
      until?: string
      masks?: Mask[]
      // The `parity/deviations/<name>.md` files that allow this checkpoint to differ, one per row.
      deviation?: string[]
    }

export type AppScenario = {
  width?: number
  height?: number
  // cli.json `Info`; both sides add `animations: false`.
  config?: Record<string, unknown>
  args?: {
    sessionID?: string
    continue?: boolean
    fork?: boolean
    prompt?: string
    model?: string
    agent?: string
    newSessionID?: string
  }
  // Environment variables the TUI reads at startup, such as `OPENCODE_ROUTE`.
  env?: Record<string, string>
  routes?: Route[]
  steps: Step[]
  // A deviation that allows the request comparison (P-REQ) to differ.
  requests?: { deviation: string }
}

export function defineApp(scenario: AppScenario) {
  return scenario
}

// The Rust client implements the TUI with the `new-designs` experiment on, and only that, so every recording
// turns it on. A config that sets the experiment itself keeps its value.
export function withNewDesigns(config: Record<string, unknown>) {
  const experimental = (config.experimental ?? {}) as Record<string, unknown>
  return { ...config, experimental: { "new-designs": true, ...experimental } }
}

// Wire objects with fixed times, as the server sends them.

export function session(id: string, title: string, input: { updated?: number; directory?: string } = {}) {
  const updated = input.updated ?? 1
  return {
    id,
    title,
    projectID: "proj_test",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: updated, updated },
    location: { directory: input.directory ?? "/tmp/opencode/packages/tui" },
  }
}

export function user(id: string, text: string, created = 1) {
  return { id, type: "user", text, time: { created } }
}

export function assistant(id: string, content: unknown[] | string, created = 2) {
  return {
    id,
    type: "assistant",
    agent: "build",
    model: { providerID: "provider", id: "model" },
    content: typeof content === "string" ? [{ type: "text", text: content }] : content,
    finish: "stop",
    time: { created, completed: created + 1 },
  }
}

// The style of a masked cell, on both sides.
export const MASKED_STYLE = "#00000000 #00000000 0"

// Blanks the masked cells of a fixture. crates/parity/src/app.rs does the same to the Rust capture.
export function applyMasks(fixture: Fixture, masks: Mask[]): Fixture {
  if (masks.length === 0) return fixture
  const symbols = fixture.rows.map((row) => (typeof row === "string" ? [...row] : [...row]))
  const styles = fixture.runs.map((runs) =>
    runs.flatMap(([style, count]) => Array<string>(count).fill(fixture.styles[style])),
  )
  const blank = (x: number, y: number) => {
    if (y < 0 || y >= fixture.height || x < 0 || x >= fixture.width) return
    symbols[y][x] = " "
    styles[y][x] = MASKED_STYLE
  }
  for (const mask of masks) {
    if ("line" in mask) {
      symbols.forEach((row, y) => {
        // The UTF-16 offset where each cell starts, so a match maps back to cells.
        const starts = row.reduce<number[]>(
          (all, symbol, x) => [...all, x === 0 ? 0 : all[x - 1] + row[x - 1].length],
          [],
        )
        for (const match of row.join("").matchAll(new RegExp(mask.line, "g"))) {
          const end = match.index + match[0].length
          starts.forEach((start, x) => start >= match.index && start < end && blank(x, y))
        }
      })
      continue
    }
    for (let y = mask.y; y < mask.y + mask.height; y++) for (let x = mask.x; x < mask.x + mask.width; x++) blank(x, y)
  }
  const palette = new Map<string, number>()
  return {
    width: fixture.width,
    height: fixture.height,
    rows: symbols.map((row) => (row.every((symbol) => [...symbol].length === 1) ? row.join("") : row)),
    runs: styles.map((row) =>
      row.reduce<[number, number][]>((runs, key) => {
        const style = palette.get(key) ?? palette.set(key, palette.size).get(key)!
        const last = runs.at(-1)
        if (last && last[0] === style) last[1]++
        else runs.push([style, 1])
        return runs
      }, []),
    ),
    styles: [...palette.keys()],
  }
}
