// P-TUI version of `E.14/stats.app.ts`: `/stats` (F11) over the simulated server's own
// `GET /api/experimental/session/stats` (never the user's service, whose stats endpoint crashes it), after one
// session with two turns ran on it. The range and the activity calendar end today, so the captures change from day
// to day; both sides of a run see the same day.
import { defineSim } from "../../sim/scenario"

export default defineSim({
  sessions: [{ title: "Count the tokens", prompts: ["Count the tokens", "Count them again"] }],
  model: [
    { items: [{ type: "textDelta", text: "Counted." }] },
    { items: [{ type: "textDelta", text: "Counted again." }] },
  ],
  steps: [
    {
      checkpoint: "home",
      until: "Simulated Model",
      masks: [{ line: "Ask anything….*", reason: "the prompt placeholder is picked at random (T17-home-prompt)" }],
      deviation: ["T17-home-prompt", "P15-metadata-gap-fg"],
    },
    { type: "/stats" },
    { until: "/stats" },
    { enter: true },
    { checkpoint: "poster", until: "opencode / stats" },
  ],
})
