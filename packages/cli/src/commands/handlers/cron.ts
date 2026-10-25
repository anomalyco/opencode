import fs from "node:fs"
import path from "node:path"
import { Effect } from "effect"
import { Global } from "@bolt-ai/core/global"
import { UI } from "../ui"
import { effectCmd, fail } from "../effect-cmd"
import { spawnJob } from "./jobs"

const DIR = path.join(Global.Path.state, "cron")

export type Entry = {
  id: string
  schedule: string
  prompt: string
  cwd: string
  created: number
}

const BOUNDS = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  { min: 1, max: 12 },
  { min: 0, max: 7 },
]

/** Parse one cron field (star, steps, ranges, lists) into the matching set. */
export function field(spec: string, min: number, max: number): Set<number> | undefined {
  const values = new Set<number>()
  for (const part of spec.split(",")) {
    const step = part.includes("/") ? Number(part.split("/")[1]) : 1
    if (!Number.isInteger(step) || step < 1) return undefined
    const range = part.split("/")[0]
    const bounds = (() => {
      if (range === "*") return [min, max]
      if (range.includes("-")) return range.split("-").map(Number)
      const single = Number(range)
      // A stepped single value like 5/2 is invalid cron; plain numbers only.
      if (part.includes("/") && range !== "*" && !range.includes("-")) return [NaN, NaN]
      return [single, single]
    })()
    const [lo, hi] = bounds
    if (!Number.isInteger(lo) || !Number.isInteger(hi)) return undefined
    if (lo < min || hi > max || lo > hi) return undefined
    for (let value = lo; value <= hi; value += step) values.add(value)
  }
  return values
}

/** Validate a 5-field cron expression; returns an error message or undefined. */
export function validate(expr: string) {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return "expected 5 fields: minute hour day-of-month month day-of-week"
  for (const [index, part] of parts.entries()) {
    const bounds = BOUNDS[index]
    if (!field(part, bounds.min, bounds.max)) return `invalid field "${part}" (position ${index + 1})`
  }
  return undefined
}

/** Whether a cron expression matches the given date (minute resolution). */
export function matches(expr: string, date: Date) {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return false
  const sets = parts.map((part, index) => field(part, BOUNDS[index].min, BOUNDS[index].max))
  if (sets.some((set) => !set)) return false
  const [minute, hour, dom, month, dow] = sets as Set<number>[]
  const day = date.getDay()
  const domMatch = dom.has(date.getDate())
  const dowMatch = dow.has(day) || (day === 0 && dow.has(7))
  // POSIX/Vixie cron: when both day-of-month and day-of-week are restricted, the
  // day matches if EITHER matches; when one is `*` it matches every day, so the
  // AND below degrades to the restricted field on its own.
  const dayMatch = parts[2] !== "*" && parts[4] !== "*" ? domMatch || dowMatch : domMatch && dowMatch
  return minute.has(date.getMinutes()) && hour.has(date.getHours()) && month.has(date.getMonth() + 1) && dayMatch
}

function entries(): Entry[] {
  if (!fs.existsSync(DIR)) return []
  return fs
    .readdirSync(DIR)
    .filter((file) => file.endsWith(".json"))
    .flatMap((file) => {
      const parsed = (() => {
        try {
          return JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8")) as Entry
        } catch {
          return undefined
        }
      })()
      return parsed ? [parsed] : []
    })
    .sort((a, b) => a.created - b.created)
}

export const CronCommand = effectCmd({
  command: "cron <action> [args..]",
  describe: "schedule recurring agent chores (dependency bumps, triage, drafts)",
  instance: false,
  builder: (yargs) =>
    yargs
      .positional("action", {
        type: "string",
        choices: ["add", "list", "rm", "start"] as const,
        demandOption: true,
        describe: "add a schedule, list them, remove one, or start the scheduler",
      })
      .positional("args", {
        type: "string",
        array: true,
        default: [],
        describe: 'add: "<schedule>" "<prompt>"; rm: <id>',
      }),
  handler: Effect.fn("Cli.cron")(function* (args) {
    if (args.action === "add") {
      const [schedule, prompt] = args.args
      if (!schedule || !prompt) return yield* fail('usage: bolt cron add "*/30 * * * *" "triage new issues"')
      const invalid = validate(schedule)
      if (invalid) return yield* fail(`invalid schedule: ${invalid}`)
      fs.mkdirSync(DIR, { recursive: true })
      const entry: Entry = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        schedule,
        prompt,
        cwd: process.cwd(),
        created: Date.now(),
      }
      fs.writeFileSync(path.join(DIR, `${entry.id}.json`), JSON.stringify(entry, null, 2))
      UI.println(`Added cron entry ${entry.id}: "${schedule}" -> "${prompt}"`)
      UI.println("Run the scheduler with: bolt cron start")
      return
    }

    if (args.action === "list") {
      const all = entries()
      if (all.length === 0) {
        UI.println('No cron entries. Add one with: bolt cron add "0 9 * * 1" "draft the weekly changelog"')
        return
      }
      for (const entry of all) UI.println(`${entry.id}  ${entry.schedule.padEnd(14)}  ${entry.cwd}  ${entry.prompt}`)
      return
    }

    if (args.action === "rm") {
      const [id] = args.args
      if (!id) return yield* fail("usage: bolt cron rm <id>")
      const entry = entries().find((item) => item.id === id || item.id.startsWith(id))
      if (!entry) return yield* fail(`no cron entry matching "${id}". Run: bolt cron list`)
      fs.rmSync(path.join(DIR, `${entry.id}.json`))
      UI.println(`Removed cron entry ${entry.id}.`)
      return
    }

    const all = entries()
    if (all.length === 0) return yield* fail('no cron entries. Add one first: bolt cron add "<schedule>" "<prompt>"')
    UI.println(`Scheduler running with ${all.length} entr${all.length === 1 ? "y" : "ies"}. Press ctrl+c to stop.`)
    yield* Effect.promise(
      () =>
        new Promise<never>(() => {
          const tick = () => {
            const now = new Date()
            for (const entry of entries()) {
              if (!matches(entry.schedule, now)) continue
              const job = spawnJob(["run", entry.prompt], entry.cwd)
              UI.println(`[${now.toISOString()}] ${entry.id} -> job ${job.id} (bolt jobs tail ${job.id})`)
            }
            const next = 60_000 - (Date.now() % 60_000)
            setTimeout(tick, next)
          }
          setTimeout(tick, 60_000 - (Date.now() % 60_000))
        }),
    )
  }),
})
