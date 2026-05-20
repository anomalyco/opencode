import type { Argv } from "yargs"
import { Effect } from "effect"
import { effectCmd, fail } from "../effect-cmd"
import { Database } from "@/storage/db"
import { SessionTable } from "@/session/session.sql"

export const UsageCommand = effectCmd({
  command: "usage",
  describe: "show token usage",
  builder: (yargs: Argv) =>
    yargs
      .option("url", { describe: "base URL of console (default: http://localhost:3000)", type: "string" })
      .option("workspace", { describe: "workspace ID", type: "string" })
      .option("session", { describe: "session ID (optional)", type: "string" })
      .option("remote", { describe: "force remote console API mode", type: "boolean", default: false })
      .option("json", { describe: "print raw JSON", type: "boolean" }),
  handler: Effect.fn("Cli.usage")(function* (args) {
    const data = yield* (
      args.remote
        ? remoteUsage(args)
        : remoteUsage(args).pipe(
            Effect.catchIf(
              () => true,
              () => localUsage(args),
            ),
          )
    )

    if (args.json) {
      console.log(JSON.stringify(data, null, 2))
      return
    }

    console.log("Usage summary:\n")
    console.log(`Session total: ${data.tokens_session_total ?? 0}`)
    console.log(`Daily:         ${data.tokens_daily ?? 0}`)
    console.log(`Weekly:        ${data.tokens_weekly ?? 0}`)
    console.log(`Monthly:       ${data.tokens_monthly ?? 0}`)
    console.log(`Total:         ${data.tokens_total ?? 0}`)
    console.log(`TPS (est):     ${data.tokens_per_second ?? 0}`)
  }),
})

type UsageArgs = {
  url?: string
  workspace?: string
  session?: string
  remote?: boolean
  json?: boolean
}

const remoteUsage = Effect.fn("Cli.usage.remote")(function* (args: UsageArgs) {
  const workspace = args.workspace as string | undefined
  if (!workspace) return yield* fail("--workspace is required in --remote mode")
  const base = (args.url as string) || "http://localhost:3000"
  const params = new URLSearchParams()
  params.set("workspaceID", workspace)
  if (args.session) params.set("sessionID", args.session)
  const url = `${base.replace(/\/+$/g, "")}/api/usage.json?${params.toString()}`
  const resp = yield* Effect.promise(async () => fetch(url))
  if (!resp.ok) {
    const details = yield* Effect.promise(async () => {
      try {
        const text = await resp.text()
        if (!text) return ""
        try {
          const json = JSON.parse(text)
          return json?.error ? ` - ${json.error}` : ` - ${text.slice(0, 300)}`
        } catch {
          return ` - ${text.slice(0, 300)}`
        }
      } catch {
        return ""
      }
    })
    return yield* fail(`request failed: ${resp.status} ${resp.statusText}${details}`)
  }
  return yield* Effect.promise(async () => resp.json())
})

const localUsage = Effect.fn("Cli.usage.local")(function* (args: UsageArgs) {
  const rows = yield* Effect.sync(() => Database.use((db) => db.select().from(SessionTable).all()))
  const now = Date.now()
  const dayStart = new Date()
  dayStart.setHours(0, 0, 0, 0)
  const weekStart = (() => {
    const d = new Date()
    const offset = (d.getDay() + 6) % 7
    d.setDate(d.getDate() - offset)
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  })()
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime()
  const minuteAgo = now - 60 * 1000
  const tokenTotal = (row: (typeof rows)[number]) =>
    row.tokens_input + row.tokens_output + row.tokens_reasoning + row.tokens_cache_read + row.tokens_cache_write
  const usage = rows.map((row) => ({
    id: row.id,
    total: tokenTotal(row),
    updated: row.time_updated,
  }))
  const sessionTotal = args.session
    ? usage.filter((row) => row.id === args.session).reduce((acc, row) => acc + row.total, 0)
    : usage.reduce((acc, row) => acc + row.total, 0)
  const daily = usage.filter((row) => row.updated >= dayStart.getTime()).reduce((acc, row) => acc + row.total, 0)
  const weekly = usage.filter((row) => row.updated >= weekStart).reduce((acc, row) => acc + row.total, 0)
  const monthly = usage.filter((row) => row.updated >= monthStart).reduce((acc, row) => acc + row.total, 0)
  const total = usage.reduce((acc, row) => acc + row.total, 0)
  const lastMinute = usage.filter((row) => row.updated >= minuteAgo).reduce((acc, row) => acc + row.total, 0)
  return {
    tokens_session_total: sessionTotal,
    tokens_daily: daily,
    tokens_weekly: weekly,
    tokens_monthly: monthly,
    tokens_total: total,
    tokens_per_second: Math.round(lastMinute / 60),
    source: "local",
  }
})


