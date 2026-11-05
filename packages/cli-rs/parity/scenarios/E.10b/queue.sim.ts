// P-TUI version of `E.10b/queue.app.ts`: queued and steered prompts against the real inbox (V14, DLG38, DLG40,
// DLG41). While the first step waits, one prompt steers and two queue (`<leader>enter`); the dock above the prompt
// shows them, `<leader>q` opens its dialog, and Enter steers the second queued prompt. A click on the dock opens the
// dialog; a click on that pending steer and "Move to queue" queues it again; a click on a delivered prompt opens
// the message actions. Once the step ends, the server delivers the steer, then each queued prompt in its own turn.
import { defineSim } from "../../sim/scenario"

const duration = { line: "· \\d.*", reason: "the turn duration depends on timing, also in length; the row ends there" }
const deviation = ["P15-metadata-gap-fg"]
const leader = { press: "x", modifiers: { ctrl: true } } as const
const click = (x: number, y: number) =>
  (["down", "up"] as const).map((action) => ({ mouse: { action, x, y, button: "left" as const } }))

export default defineSim({
  model: [
    { items: [{ type: "textDelta", text: "Reading the parser." }, { hold: "busy" }] },
    { items: [{ type: "textDelta", text: "Answered the steer." }] },
    { items: [{ type: "textDelta", text: "Answered the first queued prompt." }] },
    { items: [{ type: "textDelta", text: "Answered the second queued prompt." }] },
  ],
  steps: [
    { until: "Simulated Model" },
    { type: "Read the parser" },
    { until: "Read the parser" },
    { enter: true },
    { until: "Reading the parser." },
    { type: "Steer this" },
    { until: "Steer this" },
    { enter: true },
    // TS submits asynchronously and keeps text typed before the prompt clears, and the prompt shows the same text,
    // so there is nothing to wait for.
    { sleep: 1000 },
    { checkpoint: "steer", deviation },
    { type: "First queued" },
    { until: "First queued" },
    leader,
    { enter: true },
    { until: "1 queued · First queued" },
    { type: "Second queued" },
    { until: "Second queued" },
    leader,
    { enter: true },
    { checkpoint: "dock", until: "2 queued", deviation },
    leader,
    { press: "q" },
    { checkpoint: "queued", until: "Search queued prompts", deviation },
    { arrow: "down" },
    { checkpoint: "second", until: "2 of 2", deviation },
    { enter: true },
    { checkpoint: "steered", until: "1 queued", deviation },
    // The dock.
    ...click(5, 20),
    { checkpoint: "dock-click", until: "Search queued prompts", deviation },
    { press: "escape" },
    { checkpoint: "dock-closed", until: "1 queued · First queued", deviation },
    // The pending steer of "Second queued", then "Move to queue".
    ...click(5, 13),
    { checkpoint: "pending-steer", until: "Pending steer", deviation },
    { enter: true },
    { checkpoint: "moved", until: "2 queued", deviation },
    // A delivered prompt opens the message actions.
    ...click(5, 3),
    { checkpoint: "message", until: "Message Actions", deviation },
    { press: "escape" },
    { checkpoint: "closed", until: "2 queued", deviation },
    { release: "busy" },
    { checkpoint: "drained", until: "Answered the second queued prompt.", masks: [duration], deviation },
  ],
})
