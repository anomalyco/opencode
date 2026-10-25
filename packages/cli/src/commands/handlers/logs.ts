import fs from "node:fs"
import path from "node:path"
import { Effect } from "effect"
import { Global } from "@bolt-ai/core/global"
import { effectCmd, fail } from "../effect-cmd"
import { Envelope } from "../envelope"
import { Porcelain } from "../porcelain"
import { Tail } from "@/util/tail"

const FILE = path.join(Global.Path.log, "bolt.log")

export const LEVELS = ["DEBUG", "INFO", "WARN", "ERROR"] as const

/** Parses the level=... field from a logfmt line, if present. */
export function level(line: string) {
  const match = line.match(/(?:^|\s)level=(\w+)/)
  return match ? match[1] : undefined
}

/**
 * Builds a stateful line predicate. Level filtering keeps entries at or above
 * the minimum severity; lines without a level field (stack traces, wrapped
 * output) inherit the decision of the entry they continue. Session filtering
 * matches the ID anywhere in the line (session.id=..., sessionID=...).
 */
export function filter(opts: { level?: string; session?: string }) {
  const minimum = opts.level ? LEVELS.indexOf(opts.level as (typeof LEVELS)[number]) : 0
  const flags = { keep: true }
  return (line: string) => {
    const parsed = level(line)
    if (parsed !== undefined) {
      const severity = LEVELS.indexOf(parsed as (typeof LEVELS)[number])
      flags.keep = severity === -1 || severity >= minimum
      if (flags.keep && opts.session) flags.keep = line.includes(opts.session)
      return flags.keep
    }
    // Continuation line: follow the previous entry, but still honor an
    // explicit session match so orphaned lines do not leak between sessions.
    return flags.keep
  }
}

export const LogsCommand = effectCmd({
  command: "logs",
  describe: "print the agent log",
  instance: false,
  builder: (yargs) =>
    yargs
      .option("tail", {
        describe: "number of trailing lines to print",
        type: "number",
        default: 1000,
      })
      .option("follow", {
        alias: "f",
        describe: "stream new log lines as they are written",
        type: "boolean",
        default: false,
      })
      .option("level", {
        describe: "minimum log level to show",
        type: "string",
        choices: [...LEVELS],
      })
      .option("session", {
        describe: "only show lines mentioning this session ID",
        type: "string",
      })
      .option("json", {
        describe: Envelope.DESCRIBE,
        type: "boolean",
        default: false,
      })
      .conflicts("json", "follow")
      .option("porcelain", {
        describe: Porcelain.DESCRIBE,
        type: "boolean",
        default: false,
      })
      .conflicts("porcelain", "follow")
      .conflicts("porcelain", "json"),
  handler: Effect.fn("Cli.logs")(function* (args) {
    if (!fs.existsSync(FILE)) return yield* fail(`no log file at ${FILE}`)
    const text = yield* Effect.promise(() => Bun.file(FILE).text())
    const lines = text.split("\n")
    if (lines.at(-1) === "") lines.pop()
    const filtered = args.level || args.session ? lines.filter(filter(args)) : lines
    const count = Math.max(0, Math.floor(args.tail))
    // slice(-0) === slice(0) returns the whole array, so guard 0 explicitly to
    // mean "print no history" (e.g. `logs --tail 0 --follow` to stream only new lines).
    const shown = count === 0 ? [] : filtered.slice(-count)
    if (args.json) {
      Envelope.print({ file: FILE, lines: shown })
      return
    }
    if (args.porcelain) {
      for (const line of shown) Porcelain.print("log", line)
      return
    }
    if (!args.follow) {
      const { Pager } = yield* Effect.promise(() => import("../pager"))
      yield* Effect.promise(() => Pager.page(shown.join("\n")))
      return
    }
    for (const line of shown) console.log(line)
    // Follow by re-reading appended bytes whenever the file changes; the log
    // is append-only so the previous size is always a valid resume offset.
    yield* Effect.callback<void>(() => {
      const live = args.level || args.session ? filter(args) : undefined
      const close = Tail.follow(FILE, Buffer.byteLength(text), live)
      return Effect.sync(close)
    })
  }),
})
