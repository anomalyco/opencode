// P-ORACLE for C.3: `activityCalendar` and the `stats` command's `renderStats` over fixed inputs. Writes
// parity/fixtures/C.3/stats.json; the tests in crates/cli/src/commands/stats.rs evaluate the Rust ports
// on the same inputs and compare.
//
// Both read process state: `activityCalendar` takes local dates (TZ), and the stats palette comes from
// COLORFGBG when the module loads. So each time zone and each COLORFGBG runs in a child process. The
// time zones have fixed offsets, which the Rust test can rebuild with `FixedOffset`.
import type { SessionStatsInfo } from "@opencode/client"
import { activityCalendar } from "../../../util/src/activity-calendar"

type Child = { kind: "calendar"; tz: string } | { kind: "render"; colorfgbg?: string }

if (process.env.C3_ORACLE_CHILD) {
  const child = JSON.parse(process.env.C3_ORACLE_CHILD) as Child
  console.log(JSON.stringify(child.kind === "calendar" ? calendarCases() : await renderCases()))
  process.exit(0)
}

// `Etc/GMT-9` is UTC+9 (POSIX signs are inverted).
const zones = [
  { tz: "UTC", offset: 0 },
  { tz: "Etc/GMT-9", offset: 9 * 3600 },
  { tz: "Etc/GMT+5", offset: -5 * 3600 },
]
const palettes = [undefined, "15;0", "0;15", "0;7", "15;6", "15;default"]

const calendar = zones.flatMap((zone) =>
  run({ kind: "calendar", tz: zone.tz }, { TZ: zone.tz }).map((item: object) => ({ ...zone, ...item })),
)
const renders = palettes.map((colorfgbg) => ({
  colorfgbg: colorfgbg ?? null,
  ...run({ kind: "render", colorfgbg }, { TZ: "UTC", ...(colorfgbg === undefined ? {} : { COLORFGBG: colorfgbg }) }),
}))
// Without color the palette does not matter, so only the first palette keeps those cases.
const render = renders.map((item, index) => ({
  colorfgbg: item.colorfgbg,
  cases: item.cases.filter((entry: { options: { color: boolean } }) => index === 0 || entry.options.color),
}))

const file = new URL("../fixtures/C.3/stats.json", import.meta.url).pathname
// One case per line: the calendars and the colored renders are too long to indent.
const lines = (items: unknown[]) => `[\n${items.map((item) => JSON.stringify(item)).join(",\n")}\n]`
await Bun.write(
  file,
  `{\n"calendar": ${lines(calendar)},\n"stats": ${JSON.stringify(renders[0].stats)},\n"render": [\n${render
    .map((item) => `{"colorfgbg": ${JSON.stringify(item.colorfgbg)}, "cases": ${lines(item.cases)}}`)
    .join(",\n")}\n]\n}\n`,
)
const count = render.reduce((sum, item) => sum + item.cases.length, 0)
console.log(`stats: ${calendar.length} calendar cases, ${count} renders over ${render.length} palettes`)

function run(child: Child, env: Record<string, string>) {
  const base = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== "COLORFGBG"))
  const proc = Bun.spawnSync(["bun", "run", import.meta.path], {
    env: { ...base, ...env, C3_ORACLE_CHILD: JSON.stringify(child) },
    stderr: "inherit",
  })
  if (proc.exitCode !== 0) throw new Error(`oracle child ${JSON.stringify(child)} failed`)
  return JSON.parse(proc.stdout.toString())
}

function calendarCases() {
  const at = (year: number, month: number, day: number, hour = 0) => new Date(year, month, day, hour).getTime()
  const days = (from: string, count: number, steps: (index: number) => number) =>
    Array.from({ length: count }, (_, index) => {
      const date = new Date(`${from}T00:00:00Z`)
      date.setUTCDate(date.getUTCDate() + index)
      return { date: date.toISOString().slice(0, 10), steps: steps(index) }
    })
  const short = [
    { date: "2026-01-01", steps: 1 },
    { date: "2026-01-02", steps: 50 },
  ]
  const inputs = [
    { name: "two weeks", activity: short, from: at(2026, 0, 1), to: at(2026, 0, 8), maxWeeks: 53 },
    { name: "clipped to one week", activity: [], from: at(2026, 0, 1), to: at(2026, 0, 8), maxWeeks: 1 },
    { name: "capped at 53 weeks", activity: short, from: at(2020, 0, 1), to: at(2026, 0, 8), maxWeeks: 200 },
    { name: "partial months", activity: short, from: at(2026, 3, 29), to: at(2026, 4, 20), maxWeeks: 53 },
    { name: "one day", activity: short, from: at(2026, 3, 1), to: at(2026, 3, 2), maxWeeks: 53 },
    { name: "year boundary", activity: short, from: at(2025, 11, 22), to: at(2026, 0, 12), maxWeeks: 53 },
    {
      name: "leap day",
      activity: [
        { date: "2024-02-29", steps: 1 },
        { date: "2024-03-10", steps: 1 },
      ],
      from: at(2024, 1, 26),
      to: at(2024, 2, 12),
      maxWeeks: 53,
    },
    {
      name: "one distinct count",
      activity: short.map((day) => ({ ...day, steps: 10 })),
      from: at(2026, 0, 1),
      to: at(2026, 0, 8),
      maxWeeks: 53,
    },
    {
      name: "eight levels",
      activity: days("2026-01-01", 8, (index) => index + 1),
      from: at(2026, 0, 1),
      to: at(2026, 0, 10),
      maxWeeks: 53,
    },
    {
      name: "clipped keeps range levels",
      activity: [
        { date: "2026-01-01", steps: 50 },
        { date: "2026-01-05", steps: 1 },
      ],
      from: at(2026, 0, 1),
      to: at(2026, 0, 8),
      maxWeeks: 1,
    },
    { name: "empty range", activity: [], from: at(2026, 0, 1), to: at(2026, 0, 1), maxWeeks: 53 },
    { name: "reversed range", activity: [], from: at(2026, 0, 8), to: at(2026, 0, 1), maxWeeks: 53 },
    {
      name: "a year so far, mid-day end",
      activity: days("2026-01-01", 300, (index) => (index * 37) % 23),
      from: at(2026, 0, 1),
      to: at(2026, 9, 27, 15) + 1,
      maxWeeks: 76,
    },
    {
      name: "a past year, narrow",
      activity: days("2025-03-01", 40, (index) => (index % 5) * 3),
      from: at(2025, 0, 1),
      to: at(2026, 0, 1),
      maxWeeks: 16.7,
    },
    { name: "negative width", activity: short, from: at(2026, 0, 1), to: at(2026, 0, 20), maxWeeks: -3 },
    {
      name: "duplicate dates and outside activity",
      activity: [
        { date: "2026-01-03", steps: 4 },
        { date: "2026-01-03", steps: 9 },
        { date: "2025-06-01", steps: 100 },
        { date: "2026-01-04", steps: 0 },
      ],
      from: at(2026, 0, 1),
      to: at(2026, 0, 8),
      maxWeeks: 53,
    },
    { name: "UTC-midnight edges", activity: short, from: Date.UTC(2026, 0, 1), to: Date.UTC(2026, 1, 1), maxWeeks: 53 },
  ]
  return inputs.map((input) => ({ input, output: activityCalendar(input) }))
}

async function renderCases() {
  const { renderStats } = await import("../../../cli/src/commands/handlers/stats")
  const day = 86_400_000
  const from = Date.UTC(2026, 10, 4) - 364 * day
  const to = Date.UTC(2026, 10, 4, 15, 30) + 1
  const activity = Array.from({ length: 365 }, (_, index) => ({
    date: new Date(from + index * day).toISOString().slice(0, 10),
    steps: index % 3 === 0 ? 0 : ((index * 7919) % 97) + 1,
  }))
  const tokens = (input: number, output: number, reasoning: number, read: number, write: number) => ({
    input,
    output,
    reasoning,
    cache: { read, write },
  })
  const tool = (name: string, calls: number, succeeded: number, failed: number, durationP50?: number) => ({
    name,
    calls,
    succeeded,
    failed,
    unfinished: calls - succeeded - failed,
    ...(durationP50 === undefined ? {} : { durationP50 }),
  })
  const full: SessionStatsInfo = {
    range: { from, to },
    sessions: 1234,
    subagents: 56,
    prompts: 9_876,
    steps: 54_321,
    tokens: tokens(12_345_678, 2_345_678, 345_678, 987_654_321, 12_345_678),
    cost: 1234.565,
    tools: {
      mode: "detail",
      totals: { calls: 5000, succeeded: 4900, failed: 75, unfinished: 25 },
      usage: [
        tool("read", 2000, 1990, 10, 12.4),
        tool("bash", 1500, 1400, 75, 1534),
        tool("edit", 800, 800, 0, 999.5),
        tool("a-very-long-tool-name-from-some-mcp-server_with_suffix", 400, 399, 1, 120_000),
        tool("pending", 300, 0, 0),
        tool("webfetch", 5, 4, 1, 0.4),
      ],
    },
    activeDays: 243,
    streak: 17,
    activity,
    models: [
      {
        model: { providerID: "anthropic", id: "claude-opus-5-5" },
        steps: 40_000,
        tokens: tokens(9_000_000, 1_000_000, 0, 500_000_000, 5_000_000),
        cost: 900.125,
      },
      {
        model: { providerID: "openai", id: "gpt-5", variant: "high" },
        steps: 10_000,
        tokens: tokens(999, 1, 0, 0, 0),
        cost: 0.005,
      },
      {
        model: { providerID: "openrouter", id: "some/really-long-model-identifier-that-overflows" },
        steps: 999,
        tokens: tokens(1_999_999_999, 0, 0, 0, 0),
        cost: 334.435,
      },
      { model: { providerID: "local", id: "tiny" }, steps: 1, tokens: tokens(0, 0, 0, 0, 0), cost: 0 },
    ],
  }
  const singular: SessionStatsInfo = {
    ...full,
    sessions: 1,
    subagents: 0,
    prompts: 1,
    steps: 1,
    tokens: tokens(1, 0, 0, 0, 0),
    tools: { mode: "summary", totals: { calls: 3, succeeded: 3, failed: 0, unfinished: 0 } },
    activeDays: 1,
    streak: 1,
    range: { from: Date.UTC(2026, 10, 4), to: Date.UTC(2026, 10, 4, 9) + 1 },
    activity: [{ date: "2026-11-04", steps: 1 }],
    models: [],
  }
  const noTools: SessionStatsInfo = {
    ...singular,
    sessions: 2,
    tools: { mode: "summary", totals: { calls: 2, succeeded: 0, failed: 0, unfinished: 2 } },
  }
  const noToolStats: SessionStatsInfo = { ...singular, sessions: 3, tools: { mode: "none" } }
  const noDetails: SessionStatsInfo = {
    ...singular,
    tools: { mode: "detail", totals: { calls: 0, succeeded: 0, failed: 0, unfinished: 0 }, usage: [] },
  }
  const empty: SessionStatsInfo = {
    ...singular,
    sessions: 0,
    prompts: 0,
    steps: 0,
    tokens: tokens(0, 0, 0, 0, 0),
    cost: 0,
    activeDays: 0,
    streak: 0,
    activity: [],
  }
  const base = { label: "last 365 days", scope: "all projects", models: false, tools: false, cost: false, limit: 5 }
  const options = [
    { name: "summary", width: 80 },
    { name: "summary wide", width: 120 },
    { name: "summary narrow", width: 40 },
    { name: "summary tiny", width: 3 },
    { name: "models", width: 80, models: true },
    { name: "models narrow", width: 60, models: true, limit: 2 },
    { name: "tools", width: 68, tools: true, limit: 3 },
    { name: "tools narrow", width: 67, tools: true },
    { name: "tools one more", width: 30, tools: true, limit: 5 },
    { name: "cost", width: 80, cost: true },
    { name: "full", width: 100, models: true, tools: true, cost: true, label: "2026 so far", scope: "current project" },
    { name: "full narrow", width: 50, models: true, tools: true, cost: true, limit: 1 },
  ]
  const inputs = [
    { stats: "full", value: full },
    { stats: "singular", value: singular },
    { stats: "no tool calls", value: noTools },
    { stats: "no tool stats", value: noToolStats },
    { stats: "no details", value: noDetails },
    { stats: "empty", value: empty },
  ]
  // Every layout for the full stats; the summary and the detail sections for the others.
  const cases = inputs.flatMap((input) =>
    options
      .filter((option) => input.stats === "full" || ["summary", "full", "full narrow"].includes(option.name))
      .flatMap((option) =>
        [false, true].map((color) => {
          const { name, ...rest } = option
          const resolved = { ...base, ...rest, color }
          return { stats: input.stats, name, options: resolved, output: renderStats(input.value, resolved) }
        }),
      ),
  )
  return { stats: Object.fromEntries(inputs.map((input) => [input.stats, input.value])), cases }
}
