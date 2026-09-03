import { describe, expect, test } from "bun:test"
import type { SessionStatsInfo } from "@opencode-ai/client"
import { statsMetrics, statsNumber } from "../src/feature-plugins/system/stats-data"

const stats: SessionStatsInfo = {
  range: { from: new Date(2026, 0, 1).getTime(), to: new Date(2026, 0, 8).getTime() },
  sessions: 12,
  subagents: 99,
  prompts: 24,
  steps: 50,
  activeDays: 2,
  streak: 2,
  tokens: { input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 } },
  cost: 0,
  tools: { mode: "none" },
  models: [],
  activity: [
    { date: "2026-01-01", steps: 1 },
    { date: "2026-01-02", steps: 50 },
  ],
}

describe("stats poster", () => {
  test("includes all token categories and replaces subagents with tokens", () => {
    expect(statsMetrics(stats)).toEqual([
      { label: "tokens", value: 15 },
      { label: "best streak", value: 2 },
      { label: "active days", value: 2 },
      { label: "sessions", value: 12 },
    ])
    expect([0, 685, 5284, 9_200_000_000].map(statsNumber)).toEqual(["0", "685", "5.3K", "9.2B"])
  })
})
