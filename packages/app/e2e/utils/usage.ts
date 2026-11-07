import type { SessionStatsInfo, UsageLimitsInfo } from "@opencode/client/promise"

export function usageLimits(): UsageLimitsInfo {
  return {
    workspace: { id: "usage-workspace", name: "Usage workspace", usageURL: "https://opencode.ai/workspace/usage" },
    go: {
      rolling: { percent: 12, limited: false, resetsAt: Date.now() + 3600000 },
      weekly: { percent: 36, limited: false, resetsAt: Date.now() + 86400000 },
      monthly: { percent: 24, limited: false, resetsAt: Date.now() + 7 * 86400000 },
    },
    budgets: [],
  }
}

export function usageStats(from: number, to: number): SessionStatsInfo {
  const tokens = { input: 1200, output: 300, reasoning: 100, cache: { read: 400, write: 0 } }
  const date = new Date(to)
  return {
    range: { from, to },
    sessions: 1,
    subagents: 0,
    prompts: 2,
    steps: 3,
    tokens,
    cost: 0.42,
    activeDays: 1,
    streak: 1,
    activity: [
      {
        date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
        steps: 3,
      },
    ],
    models: [{ model: { providerID: "openai", id: "usage-model" }, steps: 3, tokens, cost: 0.42 }],
    tools: {
      mode: "detail",
      totals: { calls: 5, succeeded: 4, failed: 1, unfinished: 0 },
      usage: [{ name: "skill", calls: 5, succeeded: 4, failed: 1, unfinished: 0 }],
    },
    skills: [{ id: "effect", calls: 5 }],
    sessionUsage: [
      {
        sessionID: "ses_usage",
        title: to - from > 7 * 86400000 ? "Monthly work" : "Weekly work",
        steps: 3,
        cost: 0.42,
        tokens,
      },
    ],
  }
}

export function emptyUsageStats(from: number, to: number): SessionStatsInfo {
  return {
    range: { from, to },
    sessions: 0,
    subagents: 0,
    prompts: 0,
    steps: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    cost: 0,
    activeDays: 0,
    streak: 0,
    activity: [],
    models: [],
    sessionUsage: [],
    skills: [],
    tools: { mode: "detail", totals: { calls: 0, succeeded: 0, failed: 0, unfinished: 0 }, usage: [] },
  }
}
