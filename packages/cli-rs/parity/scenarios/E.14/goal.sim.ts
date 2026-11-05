// P-TUI version of `E.14/goal.app.ts`: the goal under the prompt (F02, DLG45) from the server's goal plugin. `/goal`
// arms the goal and starts its first round, which waits; `◎ goal` shows under the prompt; a click opens the goal
// dialog with the objective, and `p` pauses it through `/goal pause`. The plugin's `changed` event shows the paused
// goal in the dialog and the footer. The round ends after the pause, so the reviewer never runs.
import { defineSim } from "../../sim/scenario"

const duration = { line: "· \\d.*", reason: "the turn duration depends on timing, also in length; the row ends there" }
const deviation = ["P15-metadata-gap-fg"]
const click = (x: number, y: number) =>
  (["down", "up"] as const).map((action) => ({ mouse: { action, x, y, button: "left" as const } }))

export default defineSim({
  model: [{ items: [{ type: "textDelta", text: "Working on it." }, { hold: "round" }] }],
  steps: [
    { until: "Simulated Model" },
    { type: "/goal Ship the sidebar with every built-in section" },
    { until: "built-in section" },
    { enter: true },
    { checkpoint: "status", until: "◎ goal", deviation },
    ...click(75, 28),
    { checkpoint: "dialog", until: "pause p", deviation },
    { press: "p" },
    { checkpoint: "paused", until: "Paused by the user", deviation },
    { press: "escape" },
    { checkpoint: "footer", until: "goal paused", deviation },
    { release: "round" },
    { checkpoint: "ended", until: "Build · Simulated Model ·", masks: [duration], deviation },
  ],
})
