// MS1 end to end: a new session from home, one prompt, a streamed reply with one shell call that asks for
// permission, the permission allowed with a click, and the final reply.
import { defineSim } from "../../sim/scenario"

export default defineSim({
  permissions: [{ action: "shell", resource: "*", effect: "ask" }],
  model: [
    {
      items: [
        { type: "textDelta", text: "I will print the greeting first." },
        {
          type: "toolCall",
          index: 0,
          id: "call_1",
          name: "shell",
          input: { command: "echo hello", description: "Print a greeting" },
        },
      ],
      finish: "tool-calls",
    },
    { items: [{ type: "textDelta", text: "The command printed hello." }] },
  ],
  steps: [
    // The model line shows once the catalogs have loaded. The TS TUI drops an Enter before that; Rust holds it
    // (P02-early-enter), so the wait keeps both sides comparable.
    {
      checkpoint: "home",
      until: "Simulated Model",
      masks: [{ line: "Ask anything….*", reason: "the placeholder is random" }],
      deviation: ["T17-home-prompt", "P15-metadata-gap-fg"],
    },
    { type: "Say hello" },
    { until: "Say hello" },
    { enter: true },
    { checkpoint: "permission", until: "Permission required" },
    // "Allow once" in the permission dock.
    { mouse: { action: "down", x: 6, y: 27, button: "left" } },
    { mouse: { action: "up", x: 6, y: 27, button: "left" } },
    {
      checkpoint: "replied",
      until: "The command printed hello.",
      masks: [
        {
          line: "· \\d.*",
          reason: "the turn duration depends on timing, also in length (980ms, 1.0s); the row ends there",
        },
      ],
      deviation: ["P15-metadata-gap-fg"],
    },
  ],
})
