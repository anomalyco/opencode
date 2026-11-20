import { describe, expect, test } from "bun:test"
import { ClientError, type SessionStatsInfo } from "@opencode/client"
import { Effect } from "effect"
import { renderStats, request } from "../src/commands/handlers/stats"

const tools = {
  mode: "detail",
  totals: { calls: 10, succeeded: 8, failed: 2, unfinished: 0 },
  usage: [{ name: "private_tool", calls: 10, succeeded: 8, failed: 2, unfinished: 0, durationP50: 250 }],
} satisfies SessionStatsInfo["tools"]

const stats: SessionStatsInfo = {
  range: { from: Date.UTC(2026, 0, 1), to: Date.UTC(2026, 0, 8) },
  sessions: 2,
  subagents: 1,
  prompts: 4,
  steps: 6,
  tokens: { input: 10_000, output: 2_000, reasoning: 1_000, cache: { read: 5_000, write: 500 } },
  cost: 12.34,
  tools,
  activeDays: 2,
  streak: 2,
  activity: [
    { date: "2026-01-02", steps: 2 },
    { date: "2026-01-03", steps: 4 },
  ],
  models: [
    {
      model: { providerID: "anthropic", id: "sonnet" },
      steps: 6,
      tokens: { input: 10_000, output: 2_000, reasoning: 1_000, cache: { read: 5_000, write: 500 } },
      cost: 12.34,
    },
  ],
}

describe("stats rendering", () => {
  test("keeps the default card shareable", () => {
    const output = renderStats(stats, options())
    expect(output).toContain("opencode stats · 2026 so far · all projects")
    expect(output).toContain("activity")
    expect(output).toMatch(/Mo .*(?:\r?\n){2}Tu/)
    expect(output).toMatch(/Su .*(?:\r?\n){2}   less/)
    expect(output).toContain("less ·░▒▓█ more")
    expect(output).toContain("2 sessions · 1 subagent")
    expect(output).toContain("80.0% tool success · 2 active days · best streak 2 days")
    expect(output).not.toContain("private_tool")
    expect(output).not.toContain("$12.34")
  })

  test("renders shared intensity levels and partial month labels", () => {
    const output = renderStats(
      {
        ...stats,
        range: { from: new Date(2026, 3, 29).getTime(), to: new Date(2026, 4, 20).getTime() },
        activity: [{ date: "2026-04-29", steps: 1 }],
      },
      options(),
    )
    expect(output).toContain("    May")
    expect(output).not.toContain("Apr")
    expect(output.split(/\r?\n/).find((line) => line.startsWith("We "))).toContain("\u2588")
  })

  test("renders only requested detail tables", () => {
    const output = renderStats(stats, options({ tools: true, cost: true }))
    expect(output).toContain("COST & TOKENS")
    expect(output).toContain("TOOL RELIABILITY")
    expect(output).toContain("private_tool")
    expect(output).toContain("tool")
    expect(output).toContain("calls")
    expect(output).toContain("cached input        32.3%")
    expect(output).not.toContain("opencode stats")
    expect(output).not.toContain("activity")
  })

  test("shows when detail tables omit rows", () => {
    const output = renderStats(
      {
        ...stats,
        models: [
          ...stats.models,
          {
            model: { providerID: "anthropic", id: "haiku" },
            steps: 2,
            tokens: { input: 2_000, output: 500, reasoning: 0, cache: { read: 1_000, write: 0 } },
            cost: 1.25,
          },
        ],
        tools: {
          mode: "detail",
          totals: tools.totals,
          usage: [...tools.usage, { name: "grep", calls: 4, succeeded: 4, failed: 0, unfinished: 0, durationP50: 20 }],
        },
      },
      options({ models: true, tools: true, limit: 1 }),
    )
    expect(output).toContain("+1 more model")
    expect(output).toContain("+1 more tool")
  })

  test("aligns wide stats labels by terminal width", () => {
    const output = renderStats(
      {
        ...stats,
        models: ["model", "模型", "e\u0301", "猫".repeat(30)].map((id) => ({
          model: { providerID: "custom", id },
          steps: 6,
          tokens: { input: 42, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          cost: 12.34,
        })),
        tools: {
          mode: "detail",
          totals: { calls: 10, succeeded: 8, failed: 2, unfinished: 0 },
          usage: [{ name: "工具", calls: 10, succeeded: 8, failed: 2, unfinished: 0, durationP50: 250 }],
        },
      },
      options({ models: true, tools: true, width: 80 }),
    )
    const rows = output.split(/\r?\n/)
    const modelRows = rows.filter((line) => line.startsWith("custom/"))
    const toolRow = rows.find((line) => line.startsWith("工具")) ?? ""

    expect(modelRows).toHaveLength(4)
    const asciiRows = renderStats(stats, options({ models: true, tools: true, width: 80 })).split(/\r?\n/)
    expect(asciiRows).toContain("anthropic/sonnet                       18.5k           6      $12.34")
    expect(asciiRows).toContain("private_tool                              10       20.0%       250ms")
    expect({
      modelColumns: modelRows.map((row) => Bun.stringWidth(row.slice(0, row.indexOf("42")))),
      toolColumn: Bun.stringWidth(toolRow.slice(0, toolRow.indexOf("10"))),
    }).toEqual({ modelColumns: [42, 42, 42, 42], toolColumn: 42 })
  })

  test("uses the OpenCode palette in color mode", () => {
    const output = renderStats(stats, options({ color: true }))
    expect(output).toContain("\x1b[1;36m")
    expect(output).not.toContain("38;5;45")
  })

  test("uses compact layouts in narrow terminals", () => {
    const output = renderStats(stats, options({ models: true, width: 48 }))
    expect(output).toContain("anthropic/sonnet")
    expect(output).toContain("18.5k tokens · 6 steps · $12.34")
    expect(output.split(/\r?\n/).every((line) => line.length <= 48)).toBe(true)

    const compact = renderStats(
      {
        ...stats,
        models: [
          {
            model: { providerID: "custom", id: "x".repeat(10) + "👩‍💻suffix" },
            steps: 6,
            tokens: { input: 42, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            cost: 12.34,
          },
        ],
      },
      options({ models: true, width: 20 }),
    )
    const label = compact.split(/\r?\n/).find((line) => line.startsWith("custom/")) ?? ""
    expect(label).toBe("custom/xxxxxxxxxx👩‍💻…")
    expect(Bun.stringWidth(label)).toBe(20)
  })

  test("renders a concise empty state", () => {
    const output = renderStats(
      { ...stats, sessions: 0, subagents: 0, prompts: 0, steps: 0, activeDays: 0, streak: 0, activity: [] },
      options(),
    )
    expect(output).toContain("no activity in this range")
    expect(output).not.toContain("less ·░▒▓█ more")
  })

  test("does not present uncollected tools as zero calls", () => {
    const output = renderStats({ ...stats, tools: { mode: "none" } }, options())
    expect(output).toContain("tool stats unavailable")
    expect(output).not.toContain("no tool calls")
  })

  test("labels activity when terminal width truncates the requested range", () => {
    const output = renderStats(
      { ...stats, range: { from: Date.UTC(2020, 0, 1), to: Date.UTC(2026, 0, 8) } },
      options({ width: 20 }),
    )
    expect(output).toContain("activity · last 16 weeks")
  })
})

describe("stats requests", () => {
  test("maps transport failures to the server URL", async () => {
    const cause = new ClientError("Transport")
    const error = await Effect.runPromise(Effect.flip(request("http://localhost:4096", () => Promise.reject(cause))))
    expect(error).toEqual(new Error("Could not reach server at http://localhost:4096", { cause }))
  })

  test("preserves declared API errors", async () => {
    const cause = { _tag: "InvalidRequestError", message: "Stats range must end after it starts" } as const
    const error = await Effect.runPromise(Effect.flip(request("http://localhost:4096", () => Promise.reject(cause))))
    expect(error).toBe(cause)
  })

  test("preserves unexpected response failures", async () => {
    const cause = new ClientError("UnexpectedStatus", { cause: { status: 500 } })
    const error = await Effect.runPromise(Effect.flip(request("http://localhost:4096", () => Promise.reject(cause))))
    expect(error).toBe(cause)
  })
})

function options(input: Partial<Parameters<typeof renderStats>[1]> = {}): Parameters<typeof renderStats>[1] {
  return {
    label: "2026 so far",
    scope: "all projects",
    models: false,
    tools: false,
    cost: false,
    limit: 5,
    color: false,
    width: 80,
    ...input,
  }
}
