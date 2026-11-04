// `stats --all`: no activity in the range gives the short card. The range ends now, so `to` is masked.
import { defineCli } from "../../cli/run"
import { statsRoute } from "./fixture"

export default defineCli({
  args: ["stats", "--all"],
  env: { TZ: "UTC" },
  // The range ends at the current time.
  masks: [{ pattern: /to=\d+/, replacement: "to=<masked>" }],
  server: {
    routes: [
      statsRoute({
        range: { from: 0, to: Date.UTC(2026, 10, 4) },
        sessions: 0,
        subagents: 0,
        prompts: 0,
        steps: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        cost: 0,
        tools: { mode: "summary", totals: { calls: 0, succeeded: 0, failed: 0, unfinished: 0 } },
        activeDays: 0,
        streak: 0,
        activity: [],
        models: [],
      }),
    ],
  },
})
