// `/stats` (F11): the stats route over a recorded `GET /api/experimental/session/stats` (never the live
// service, whose stats endpoint crashes it): the range, the token total in large digits, the activity calendar,
// and the streak, active days, and sessions. Escape goes back home. The range runs from noon to noon UTC, so
// its local dates are the same in UTC and in Central European time.
import { defineApp } from "../../lib/app"

const day = 86_400_000
const from = Date.UTC(2026, 0, 1, 12)
const to = from + 27 * day

export default defineApp({
  config: { experimental: { "new-designs": true } },
  routes: [
    {
      path: "/api/experimental/session/stats",
      json: {
        data: {
          range: { from, to },
          sessions: 42,
          subagents: 3,
          prompts: 120,
          steps: 300,
          tokens: { input: 1_000_000, output: 200_000, reasoning: 34_000, cache: { read: 0, write: 0 } },
          cost: 12.5,
          tools: { mode: "none" },
          activeDays: 9,
          streak: 4,
          activity: [
            { date: "2026-01-02", steps: 3 },
            { date: "2026-01-05", steps: 12 },
            { date: "2026-01-06", steps: 7 },
            { date: "2026-01-12", steps: 30 },
            { date: "2026-01-20", steps: 1 },
          ],
          models: [],
        },
      },
    },
  ],
  steps: [
    {
      checkpoint: "home",
      until: "/tmp/opencode/packages/tui:main",
      masks: [{ line: "Ask anything….*", reason: "the prompt placeholder is picked at random (T17-home-prompt)" }],
      deviation: ["T17-home-prompt"],
    },
    { type: "/stats" },
    { keys: ["enter"] },
    { checkpoint: "poster", until: "opencode / stats" },
  ],
})
