// Shared routes for the C.3 `stats` cases. The fake server answers with fixed statistics whatever the
// query says; the request log shows the query each client sent.
import type { Route } from "../../lib/fake-server"

export const location: Route = {
  path: "/api/location",
  json: { directory: "/work", project: { id: "proj_current", directory: "/work", canonical: "/work" } },
}

const day = 86_400_000

// A year of activity between `from` and `to` (local midnights in the scenario's TZ), every third day idle.
export function stats(from: number, to: number, tools: "none" | "summary" | "detail" = "detail") {
  const days = Math.round((to - from) / day)
  const totals = { calls: 412, succeeded: 400, failed: 7, unfinished: 5 }
  return {
    range: { from, to },
    sessions: 321,
    subagents: 12,
    prompts: 1_234,
    steps: 9_876,
    tokens: { input: 1_234_567, output: 234_567, reasoning: 34_567, cache: { read: 98_765_432, write: 1_234_567 } },
    cost: 123.455,
    tools:
      tools === "none"
        ? { mode: "none" }
        : tools === "summary"
          ? { mode: "summary", totals }
          : {
              mode: "detail",
              totals,
              usage: [
                { name: "read", calls: 200, succeeded: 199, failed: 1, unfinished: 0, durationP50: 8.5 },
                { name: "bash", calls: 150, succeeded: 140, failed: 6, unfinished: 4, durationP50: 2_345 },
                { name: "edit", calls: 60, succeeded: 60, failed: 0, unfinished: 0, durationP50: 41 },
                { name: "question", calls: 2, succeeded: 1, failed: 0, unfinished: 1 },
              ],
            },
    activeDays: 180,
    streak: 9,
    activity: Array.from({ length: days }, (_, index) => ({
      date: new Date(from + index * day + day / 2).toISOString().slice(0, 10),
      steps: index % 3 === 2 ? 0 : ((index * 31) % 40) + 1,
    })),
    models: [
      {
        model: { providerID: "anthropic", id: "claude-opus-5-5" },
        steps: 7_000,
        tokens: { input: 1_000_000, output: 200_000, reasoning: 30_000, cache: { read: 90_000_000, write: 1_000_000 } },
        cost: 100.125,
      },
      {
        model: { providerID: "openai", id: "gpt-5", variant: "high" },
        steps: 2_876,
        tokens: { input: 234_567, output: 34_567, reasoning: 4_567, cache: { read: 8_765_432, write: 234_567 } },
        cost: 23.33,
      },
    ],
  }
}

export function statsRoute(body: unknown, status = 200): Route {
  return { path: "/api/experimental/session/stats", status, json: status === 200 ? { data: body } : body }
}

// 2020 in UTC: both ends are fixed, so the request log compares exactly.
export const year2020 = stats(Date.UTC(2020, 0, 1), Date.UTC(2021, 0, 1))
