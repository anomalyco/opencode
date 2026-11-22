// P-APP scenarios (docs/testing.md): one file per scenario, `parity/scenarios/<step>/<name>.app.ts`, with
// `export default defineApp({...})`. parity/app/scenarios.test.tsx records each one through the TS TUI;
// crates/tui/tests/all/app.rs replays the recording through the Rust TUI.
import type { Fixture } from "./cells"
import type { Route } from "./fake-server"
import type { PtyScript, PtyStep } from "./pty-socket"
import { records } from "./records"

export type { Route }

export type Mask = ({ x: number; y: number; width: number; height: number } | { line: string }) & {
  reason: string
}

// The location the TS TUI runs in, as the fake server's location answers name it.
export const location = {
  directory: "/tmp/opencode/packages/tui",
  project: { id: "proj_test", directory: "/tmp/opencode", canonical: "/tmp/opencode" },
}

// A connected model with a price and a context limit, for a catalog's `model` answer.
export const model = {
  id: "model",
  modelID: "model",
  providerID: "provider",
  name: "Model",
  capabilities: { tools: true, input: ["text"], output: ["text"] },
  variants: [],
  time: { released: 0 },
  cost: [{ input: 3, output: 15, cache: { read: 0.3, write: 3.75 } }],
  status: "active",
  enabled: true,
  limit: { context: 200000, output: 32000 },
}

// The home prompt's placeholder at the default 100 columns, to the end of the row.
export const HOME_PLACEHOLDER = {
  x: 16,
  y: 16,
  width: 84,
  height: 1,
  reason: "the placeholder example: random in TS and Rust",
}

// A `parity/deviations/<file>.md` that allows a checkpoint at most `cells` differing cells. With `styleOnly`, only
// cells whose symbols match: their colors or attributes differ. A checkpoint's deviations add up.
export type Deviation = { file: string; cells: number; styleOnly?: boolean }

export type Step =
  // Shortcuts in opentui-rust's syntax: "enter", "ctrl+x", "a".
  | { keys: string[] }
  // Text, one key press per character.
  | { type: string }
  // A bracketed paste of the text (E.4).
  | { paste: string }
  // A left press and release at a cell, `[x, y]`.
  | { click: [number, number] }
  // A right press and release at a cell, `[x, y]`.
  | { rightClick: [number, number] }
  // One `/api/event` event.
  | { event: Record<string, unknown> }
  // A left-button drag from one cell to another, `[[x, y], [x, y]]`; TS moves in five steps, Rust one cell at a
  // time, and both end with the release on the target cell.
  | { drag: [[number, number], [number, number]] }
  // A notification from the fake IDE MCP server (`ide: true`), `{ method, params }`, sent once a client finished
  // the MCP handshake.
  | { ide: { method: string; params?: unknown } }
  // Output from, or the close of, the fake persistent PTY socket (parity/lib/pty-socket.ts).
  | { pty: PtyStep }
  // Answers the requests a `hold` route of this path keeps waiting, and the ones that come after.
  | { release: string }
  // Lets this many milliseconds pass with no input, so a later checkpoint sees what follows on its own.
  | { wait: number }
  | {
      checkpoint: string
      // Text the TS frame contains once it is ready.
      until?: string
      masks?: Mask[]
      deviation?: Deviation[]
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
    auto?: boolean
  }
  // Environment variables the TUI reads at startup, such as `OPENCODE_ROUTE`.
  env?: Record<string, string>
  routes?: Route[]
  // Runs a fake IDE MCP server at OPENCODE_EDITOR_SSE_PORT (E.5); the recording keeps what the TUI sent it.
  ide?: boolean
  // A Zed database built from this SQL in a temporary directory, with ZED_TERM=true and a temporary HOME (E.5).
  zed?: { sql: string }
  // Serves persistent PTY sockets with the fake shell.
  pty?: PtyScript
  steps: Step[]
  // A deviation that allows the request comparison (P-REQ) to differ.
  requests?: { deviation: string }
}

export function defineApp(scenario: AppScenario) {
  // A plugin's commands register after the screen settles, and an Enter on a completion that has not listed the typed
  // command yet does nothing, in TS as in Rust (file-browser-flake). With a plugin loaded, a typed `/command` waits
  // for its row in the completion (a checkpoint) before Enter.
  if (scenario.env?.OPENCODE_PARITY_PLUGIN)
    scenario.steps.forEach((step, index) => {
      const next = scenario.steps[index + 1]
      if ("type" in step && step.type.startsWith("/") && next && "keys" in next && next.keys[0] === "enter")
        throw new Error(`step ${index}: wait for the completion to list ${step.type} before Enter (a checkpoint)`)
    })
  return scenario
}

// The Rust client implements the TUI with the `new-designs` experiment on, and only that, so every recording
// turns it on. TS's test fixtures (`createAppFixture`, `createTuiResolvedConfig`) default to new designs off and the
// `opencode-classic` theme since #64988, so recordings also name a theme: the product's default, `opencode`, unless
// the caller names another. A config that sets the experiment or a theme itself keeps its value.
export function withNewDesigns(config: Record<string, unknown>) {
  const experimental = (config.experimental ?? {}) as Record<string, unknown>
  const theme = (config.theme ?? {}) as Record<string, unknown>
  return { ...config, experimental: { "new-designs": true, ...experimental }, theme: { name: "opencode", ...theme } }
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

// The text of a `<name>.app.json` recording: one config key, route, step, socket message, write and read per line.
export function recordingText(recording: unknown) {
  return records(recording, [
    "config.*",
    "args.*",
    "env.*",
    "routes[]",
    "ide[]",
    "zed.*",
    "steps[]",
    "sockets[].sent[]",
    "sockets[].received[]",
    "requests.writes[]",
    "requests.reads[]",
  ])
}
