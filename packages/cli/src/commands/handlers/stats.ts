import { OpenCode, type SessionStatsInfo } from "@opencode-ai/client"
import { Service } from "@opencode-ai/client/effect/service"
import { Effect, Option } from "effect"
import { EOL } from "node:os"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { ServerConnection } from "../../services/server-connection"
import { errorMessage } from "../../util/error"

const handler = Effect.fn("cli.stats")(function* (input: Runtime.Input<typeof Commands.commands.stats>) {
  const days = Option.getOrUndefined(input.days)
  const year = Option.getOrUndefined(input.year)
  const project = Option.getOrUndefined(input.project)
  if ([days !== undefined, year !== undefined, input.all].filter(Boolean).length > 1)
    yield* Effect.fail(new Error("--days, --year, and --all cannot be combined"))

  const server = yield* ServerConnection.resolve({
    server: Option.getOrUndefined(input.server),
    standalone: input.standalone,
  })
  const client = OpenCode.make({ baseUrl: server.endpoint.url, headers: Service.headers(server.endpoint) })
  const range = statsRange({ days, year, all: input.all })
  const projectID =
    project === "."
      ? yield* request(server.endpoint.url, (signal) =>
          client.location
            .get({ location: { directory: process.cwd() } }, { signal })
            .then((location) => location.project.id),
        )
      : project
  const details = input.models || input.tools || input.cost || input.full
  const stats = yield* request(server.endpoint.url, (signal) =>
    client.session.stats(
      {
        from: range.from,
        to: range.to,
        project: projectID,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        models: input.json || input.models || input.full,
        tools: input.json || input.tools || input.full,
        toolSummary: input.json || input.tools || input.full || !details,
      },
      { signal },
    ),
  )
  const output = input.json
    ? JSON.stringify(stats, null, 2)
    : renderStats(stats, {
        label: range.label,
        scope: project === undefined ? "all projects" : project === "." ? "current project" : "selected project",
        models: input.models || input.full,
        tools: input.tools || input.full,
        cost: input.cost || input.full,
        limit: input.limit,
        color: process.stdout.isTTY && process.env.NO_COLOR === undefined,
        width: process.stdout.columns ?? 80,
      })
  process.stdout.write(output + EOL)
})

export default Runtime.handler(Commands.commands.stats, (input) =>
  handler(input).pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        process.stderr.write(errorMessage(error) + EOL)
        process.exitCode = 1
      }),
    ),
  ),
)

function request<A>(url: string, run: (signal: AbortSignal) => Promise<A>) {
  return Effect.tryPromise({
    try: () => run(AbortSignal.timeout(30_000)),
    catch: (cause) => new Error(`Could not reach server at ${url}`, { cause }),
  })
}

type RenderOptions = {
  label: string
  scope: string
  models: boolean
  tools: boolean
  cost: boolean
  limit: number
  color: boolean
  width: number
}

const colors = terminalPalette()

export function renderStats(stats: SessionStatsInfo, options: RenderOptions) {
  const totalTokens = tokenTotal(stats.tokens)
  const terminalTools = stats.tools.succeeded + stats.tools.failed
  const toolRate = terminalTools === 0 ? undefined : (stats.tools.succeeded / terminalTools) * 100
  const primary = `1;${colors.primary}`
  const sessionLine = [
    metricCount(stats.sessions, "session", options.color),
    stats.subagents > 0 ? metricCount(stats.subagents, "subagent", options.color) : undefined,
  ]
    .filter((value) => value !== undefined)
    .join(" · ")
  const toolSummary =
    toolRate === undefined ? "no tool calls" : `${style(formatPercent(toolRate), primary, options.color)} tool success`
  const details = options.models || options.tools || options.cost
  const empty = stats.sessions === 0 && stats.prompts === 0 && stats.steps === 0
  const heading = `${style("opencode stats", primary, options.color)} ${style(`· ${options.label} · ${options.scope}`, "2", options.color)}`
  const lines = details
    ? [style(`${options.label} · ${options.scope}`, "2", options.color)]
    : empty
      ? [
          heading,
          "",
          style("no activity in this range", "2", options.color),
          "",
          style("opencode.ai", "2", options.color),
        ]
      : [
          heading,
          "",
          ...renderActivity(stats.activity, stats.range.from, stats.range.to, options.color, options.width),
          "",
          sessionLine,
          `${metricCount(stats.prompts, "prompt", options.color)} · ${metricCount(stats.steps, "step", options.color)} · ${metricCount(totalTokens, "token", options.color)}`,
          `${toolSummary} · ${metricCount(stats.activeDays, "active day", options.color)} · best streak ${style(stats.streak.toString(), primary, options.color)} day${stats.streak === 1 ? "" : "s"}`,
          "",
          style("opencode.ai", "2", options.color),
        ]

  if (options.cost) lines.push(...(lines.length > 0 ? [""] : []), ...renderCost(stats))
  if (options.models)
    lines.push(...(lines.length > 0 ? [""] : []), ...renderModels(stats, options.limit, options.width))
  if (options.tools) lines.push(...(lines.length > 0 ? [""] : []), ...renderTools(stats, options.limit, options.width))
  return lines.join(EOL)
}

function statsRange(input: { days?: number; year?: number; all: boolean }) {
  const now = new Date()
  const to = now.getTime() + 1
  if (input.all) return { from: undefined, to, label: "all time" }
  if (input.days !== undefined) {
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    from.setDate(from.getDate() - Math.max(0, input.days - 1))
    return {
      from: from.getTime(),
      to,
      label: input.days === 0 || input.days === 1 ? "today" : `last ${input.days} days`,
    }
  }
  const year = input.year ?? now.getFullYear()
  return {
    from: new Date(year, 0, 1).getTime(),
    to: year === now.getFullYear() ? to : new Date(year + 1, 0, 1).getTime(),
    label: year === now.getFullYear() ? `${year} so far` : year.toString(),
  }
}

function renderActivity(
  activity: SessionStatsInfo["activity"],
  from: number,
  to: number,
  color: boolean,
  width: number,
) {
  const values = new Map(activity.map((day) => [day.date, day.steps]))
  const rangeStart = dateOrdinal(new Date(from))
  const rangeEnd = dateOrdinal(new Date(to - 1))
  const end = new Date(to - 1)
  end.setHours(12, 0, 0, 0)
  end.setDate(end.getDate() + (7 - mondayIndex(end) - 1))
  const start = new Date(from)
  start.setHours(12, 0, 0, 0)
  start.setDate(start.getDate() - mondayIndex(start))
  const maxWeeks = Math.max(1, Math.min(53, width - 4))
  const totalWeeks = Math.floor((dateOrdinal(end) - dateOrdinal(start)) / 7) + 1
  const latest = new Date(end)
  latest.setDate(latest.getDate() - (maxWeeks - 1) * 7)
  if (start < latest) start.setTime(latest.getTime())

  const active = [...values.values()].filter((value) => value > 0)
  const levels = [...new Set(active)].sort((a, b) => a - b)
  const weekStarts = Array.from({ length: Math.floor((dateOrdinal(end) - dateOrdinal(start)) / 7) + 1 }, (_, week) => {
    const date = new Date(start)
    date.setDate(date.getDate() + week * 7)
    return date
  })
  const weeks = weekStarts.map((week) =>
    Array.from({ length: 7 }, (_, day) => {
      const date = new Date(week)
      date.setDate(date.getDate() + day)
      const ordinal = dateOrdinal(date)
      if (ordinal < rangeStart || ordinal > rangeEnd) return " "
      return activityGlyph(values.get(dateKey(date)) ?? 0, levels, color)
    }),
  )
  const weekdays = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]
  return [
    style(totalWeeks > maxWeeks ? `activity · last ${maxWeeks} weeks` : "activity", `1;${colors.primary}`, color),
    `   ${style(monthLabels(weekStarts), "2", color)}`,
    ...weekdays.flatMap((label, day) => [
      `${style(label, "2", color)} ${weeks.map((week) => week[day]).join("")}`,
      ...(day === weekdays.length - 1 ? [] : [""]),
    ]),
    "",
    `   ${style("less", "2", color)} ${[0, 1, 2, 3, 4].map((level) => paintActivity(level, color)).join("")} ${style("more", "2", color)}`,
  ]
}

function renderCost(stats: SessionStatsInfo) {
  const input = stats.tokens.input + stats.tokens.cache.read + stats.tokens.cache.write
  const cached = input === 0 ? 0 : (stats.tokens.cache.read / input) * 100
  return [
    "COST & TOKENS",
    row("cost", `$${stats.cost.toFixed(2)}`),
    row("input", formatNumber(stats.tokens.input)),
    row("output", formatNumber(stats.tokens.output)),
    row("reasoning", formatNumber(stats.tokens.reasoning)),
    row("cache read", formatNumber(stats.tokens.cache.read)),
    row("cache write", formatNumber(stats.tokens.cache.write)),
    row("cached input", formatPercent(cached)),
  ]
}

function renderModels(stats: SessionStatsInfo, limit: number, width: number) {
  if (stats.models.length === 0) return ["MODELS", "  no model usage"]
  const models = stats.models.slice(0, limit)
  const more = stats.models.length - models.length
  if (width < 68)
    return [
      "MODELS",
      ...models.flatMap((item) => [
        truncate(
          `${item.model.providerID}/${item.model.id}${item.model.variant ? `#${item.model.variant}` : ""}`,
          width,
        ),
        `  ${formatNumber(tokenTotal(item.tokens))} tokens · ${formatNumber(item.steps)} steps · $${item.cost.toFixed(2)}`,
      ]),
      ...(more > 0 ? ["", `+${more.toLocaleString("en-US")} more model${more === 1 ? "" : "s"}`] : []),
    ]
  return [
    "MODELS",
    tableHeader("model", "tokens", "steps", "cost"),
    ...models.map((item) =>
      tableRow(
        `${item.model.providerID}/${item.model.id}${item.model.variant ? `#${item.model.variant}` : ""}`,
        formatNumber(tokenTotal(item.tokens)),
        formatNumber(item.steps),
        `$${item.cost.toFixed(2)}`,
      ),
    ),
    ...(more > 0 ? ["", `+${more.toLocaleString("en-US")} more model${more === 1 ? "" : "s"}`] : []),
  ]
}

function renderTools(stats: SessionStatsInfo, limit: number, width: number) {
  if (stats.toolUsage.length === 0) return ["TOOL RELIABILITY", "  no tool calls"]
  const tools = stats.toolUsage.slice(0, limit)
  const more = stats.toolUsage.length - tools.length
  if (width < 68)
    return [
      "TOOL RELIABILITY",
      ...tools.flatMap((tool) => {
        const terminal = tool.succeeded + tool.failed
        return [
          truncate(tool.name, width),
          `  ${formatNumber(tool.calls)} calls · ${terminal === 0 ? "-" : formatPercent((tool.failed / terminal) * 100)} error · ${tool.durationP50 === undefined ? "-" : formatDuration(tool.durationP50)} p50`,
        ]
      }),
      "",
      `${formatNumber(stats.tools.succeeded + stats.tools.failed)} finished calls · ${formatNumber(stats.tools.unfinished)} unfinished`,
      ...(more > 0 ? [`+${more.toLocaleString("en-US")} more tool${more === 1 ? "" : "s"}`] : []),
    ]
  return [
    "TOOL RELIABILITY",
    tableHeader("tool", "calls", "error", "p50"),
    ...tools.map((tool) => {
      const terminal = tool.succeeded + tool.failed
      return tableRow(
        tool.name,
        formatNumber(tool.calls),
        terminal === 0 ? "-" : formatPercent((tool.failed / terminal) * 100),
        tool.durationP50 === undefined ? "-" : formatDuration(tool.durationP50),
      )
    }),
    "",
    `${formatNumber(stats.tools.succeeded + stats.tools.failed)} finished calls · ${formatNumber(stats.tools.unfinished)} unfinished`,
    ...(more > 0 ? [`+${more.toLocaleString("en-US")} more tool${more === 1 ? "" : "s"}`] : []),
  ]
}

function row(label: string, value: string) {
  return `  ${label.padEnd(20)}${value}`
}

function tableHeader(label: string, second: string, third: string, fourth: string) {
  return tableRow(label, second, third, fourth)
}

function tableRow(label: string, second: string, third: string, fourth: string) {
  return `${truncate(label, 34).padEnd(34)}${second.padStart(10)}${third.padStart(12)}${fourth.padStart(12)}`
}

function truncate(value: string, width: number) {
  return value.length <= width ? value : value.slice(0, width - 1) + "…"
}

function tokenTotal(tokens: SessionStatsInfo["tokens"]) {
  return tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
}

function formatNumber(value: number) {
  if (value >= 1_000_000_000) return `${trimDecimal(value / 1_000_000_000)}b`
  if (value >= 1_000_000) return `${trimDecimal(value / 1_000_000)}m`
  if (value >= 1_000) return `${trimDecimal(value / 1_000)}k`
  return Math.round(value).toLocaleString("en-US")
}

function trimDecimal(value: number) {
  return value.toFixed(1).replace(/\.0$/, "")
}

function formatPercent(value: number) {
  return `${value.toFixed(value >= 10 ? 1 : 2)}%`
}

function formatDuration(value: number) {
  if (value < 1_000) return `${Math.round(value)}ms`
  return `${trimDecimal(value / 1_000)}s`
}

function metricCount(value: number, noun: string, color: boolean) {
  return `${style(formatNumber(value), `1;${colors.primary}`, color)} ${noun}${value === 1 ? "" : "s"}`
}

function style(value: string, code: string, color: boolean) {
  return color ? `\x1b[${code}m${value}\x1b[0m` : value
}

function activityGlyph(value: number, levels: number[], color: boolean) {
  if (value === 0) return paintActivity(0, color)
  const index = levels.indexOf(value)
  const level = Math.max(1, Math.ceil(((index + 1) / levels.length) * 4))
  return paintActivity(level, color)
}

function paintActivity(level: number, color: boolean) {
  const glyph = ["·", "░", "▒", "▓", "█"][level]
  if (!color) return glyph
  if (level === 0) return `\x1b[2m${glyph}\x1b[22m`
  return `\x1b[${colors.activity[level - 1]}m${glyph}\x1b[39m`
}

function terminalPalette() {
  const background = Number(process.env.COLORFGBG?.split(";").at(-1))
  if (Number.isFinite(background) && background >= 7)
    return {
      primary: "38;2;59;125;216",
      activity: ["38;2;153;169;192", "38;2;122;155;200", "38;2;90;140;208", "38;2;59;125;216"],
    }
  if (Number.isFinite(background))
    return {
      primary: "38;2;250;178;131",
      activity: ["38;2;117;99;87", "38;2;161;125;102", "38;2;206;152;116", "38;2;250;178;131"],
    }
  return { primary: "36", activity: ["2;36", "36", "1;36", "1;96"] }
}

function monthLabels(weeks: Date[]) {
  const line: string[] = []
  weeks.reduce((previous, week, index) => {
    const middle = new Date(week)
    middle.setDate(middle.getDate() + 3)
    const month = middle.getMonth()
    if (month === previous) return previous
    Intl.DateTimeFormat("en-US", { month: "short" })
      .format(middle)
      .split("")
      .forEach((character, offset) => {
        line[index + offset] = character
      })
    return month
  }, -1)
  return Array.from({ length: Math.max(weeks.length, line.length) }, (_, index) => line[index] ?? " ")
    .join("")
    .trimEnd()
}

function mondayIndex(date: Date) {
  return (date.getDay() + 6) % 7
}

function dateKey(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-")
}

function dateOrdinal(date: Date) {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000)
}
