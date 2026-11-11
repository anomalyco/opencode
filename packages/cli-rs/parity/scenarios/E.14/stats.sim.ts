// P-TUI version of `E.14/stats.app.ts`: `/stats` (F11) over the simulated server's own
// `GET /api/experimental/session/stats` (never the user's service, whose stats endpoint crashes it), after one
// session with two turns ran on it. The range and the activity calendar end today, so the server and both clients
// run on a clock that starts at a fixed noon (UTC), and the captures stay the same from day to day.
import { defineSim } from "../../sim/scenario"

export default defineSim({
  now: Date.UTC(2026, 5, 17, 12),
  sessions: [{ title: "Count the tokens", prompts: ["Count the tokens", "Count them again"] }],
  model: [
    { items: [{ type: "textDelta", text: "Counted." }] },
    { items: [{ type: "textDelta", text: "Counted again." }] },
  ],
  steps: [
    {
      checkpoint: "home",
      until: "Simulated Model",
      masks: [
        {
          x: 16,
          y: 16,
          width: 84,
          height: 1,
          reason: "the placeholder example: random in TS and Rust",
        },
      ],
    },
    { type: "/stats" },
    { until: "/stats" },
    { enter: true },
    { checkpoint: "poster", until: "opencode / stats" },
  ],
})
