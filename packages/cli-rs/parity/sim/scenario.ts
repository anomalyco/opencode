// P-TUI scenarios (docs/H.5.md): one file per scenario, `parity/scenarios/<step>/<name>.sim.ts`, with
// `export default defineSim({...})`. parity/sim/run.ts runs each one through both clients against the simulated
// server.
import type { Frontend } from "@opencode/protocol/simulation"
import type { Mask } from "../lib/app"
import type { Reply } from "./backend"

export type { Mask, Reply }

export type Step =
  | { type: string }
  | { press: string; modifiers?: Frontend.KeyModifiers }
  | { enter: true }
  | { arrow: "up" | "down" | "left" | "right" }
  // The `ui.mouse` parameters: Rust offers no `ui.click` or `ui.focus` (T14a), so the screen is addressed by cells.
  | { mouse: Frontend.MouseParams }
  | { resize: [number, number] }
  // Waits until the screen shows the text.
  | { until: string }
  | {
      checkpoint: string
      // Text the screen shows once it is ready.
      until?: string
      masks?: Mask[]
      // The `parity/deviations/<name>.md` files that allow this checkpoint to differ, one per row.
      deviation?: string[]
    }

export type SimScenario = {
  width?: number
  height?: number
  // Rules after the allow-all rule; the last matching rule wins.
  permissions?: { action: string; resource: string; effect: "allow" | "deny" | "ask" }[]
  // Files under the working directory, written before the server starts.
  files?: Record<string, string>
  // The replies to the session's model calls, in order. Title requests get a fixed title.
  model: Reply[]
  steps: Step[]
  // A deviation that allows the request comparison (P-REQ) to differ.
  requests?: { deviation: string }
}

export function defineSim(scenario: SimScenario) {
  return scenario
}
