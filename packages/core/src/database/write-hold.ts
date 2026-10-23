export * as WriteHold from "./write-hold"

import path from "path"
import { Effect, Option, type Context, type Fiber, type Tracer } from "effect"

// A process waiting in BEGIN or on busy_timeout already logs its own
// acquisition diagnostics, but nothing names the process holding the lock.
// Each connection tracks how long it holds SQLite's single write lock and
// warns once when a hold crosses the threshold and once when it ends.
//
// The lock is held from a successful BEGIN IMMEDIATE/EXCLUSIVE, or from the
// first write inside a deferred transaction, until the connection leaves the
// transaction. The crossing warning fires from a timer, so a transaction kept
// open across async work is reported while it is still held. A single
// autocommit statement runs synchronously and blocks the event loop, so it
// can only be reported after it returns, and its time includes any busy wait.

const DEFAULT_THRESHOLD_MS = 5000

// The only argv word logged; anything else (project paths, prompts) is "default".
const COMMANDS = new Set([
  "acp",
  "agent",
  "attach",
  "db",
  "debug",
  "export",
  "generate",
  "github",
  "import",
  "mcp",
  "models",
  "plugin",
  "pr",
  "providers",
  "run",
  "serve",
  "session",
  "stats",
  "uninstall",
  "upgrade",
  "web",
])

export type Event = "crossed" | "released" | "statement"

export function threshold(value = process.env.OPENCODE_SQLITE_WRITE_HOLD_WARN_MS) {
  if (value === undefined || value.trim() === "") return DEFAULT_THRESHOLD_MS
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_THRESHOLD_MS
}

export function classify(query: string) {
  const text = query
    .replace(/^(?:\s+|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*/, "")
    .slice(0, 160)
    .toLowerCase()
  const begin = /^begin\s+(immediate|exclusive)\b/.exec(text)
  if (begin) return { kind: `begin ${begin[1]}`, writes: true }
  const dml =
    /^(insert(?:\s+or\s+\w+)?\s+into|replace\s+into|update(?:\s+or\s+\w+)?|delete\s+from)\s+[`"[]?(\w{1,64})/.exec(text)
  if (dml) return { kind: `${dml[1].split(/\s+/)[0]} ${dml[2]}`, writes: true }
  const ddl = /^(create|drop|alter|vacuum|reindex|analyze)\b/.exec(text)
  if (ddl) return { kind: ddl[1], writes: true }
  const checkpoint = /^pragma\s+(?:\w+\.)?wal_checkpoint\s*\(\s*(full|restart|truncate)\b/.exec(text)
  if (checkpoint) return { kind: `pragma wal_checkpoint(${checkpoint[1]})`, writes: true }
  return { kind: /^[a-z_]+/.exec(text)?.[0] ?? "unknown", writes: false }
}

export function identity() {
  const command = process.argv[2]
  return {
    pid: process.pid,
    process: path.basename(process.execPath),
    command: command && COMMANDS.has(command) ? command : "default",
  }
}

export function make(inTransaction: () => boolean, thresholdMs = threshold()) {
  let hold:
    | {
        readonly started: number
        readonly statement: string
        readonly origin: Origin
        readonly context: Context.Context<never>
        readonly timer: ReturnType<typeof setTimeout>
        statements: number
        crossed: boolean
      }
    | undefined

  return function run<T>(fiber: Fiber.Fiber<unknown, unknown>, query: string, write: () => T): T {
    if (thresholdMs <= 0) return write()
    const statement = classify(query)
    const began = Date.now()
    const settle = (failed: boolean) => {
      const open = inTransaction()
      if (!hold && statement.writes && open) {
        const started = Date.now()
        const origin = describe(fiber.currentSpan)
        const context = fiber.context
        const next = {
          started,
          statement: statement.kind,
          origin,
          context,
          statements: 0,
          crossed: false,
          timer: setTimeout(() => {
            next.crossed = true
            log(context, "crossed", {
              ...origin,
              statement: next.statement,
              since: started,
              holdMs: Date.now() - started,
            })
          }, thresholdMs),
        }
        next.timer.unref?.()
        hold = next
      }
      if (hold) hold.statements++
      // A failed statement, such as a BEGIN that timed out on busy_timeout, waited and never held the lock.
      if (!hold && !failed && statement.writes && !open && Date.now() - began >= thresholdMs)
        log(fiber.context, "statement", {
          ...describe(fiber.currentSpan),
          statement: statement.kind,
          since: began,
          holdMs: Date.now() - began,
        })
      if (hold && !open) {
        const ended = hold
        hold = undefined
        clearTimeout(ended.timer)
        const holdMs = Date.now() - ended.started
        if (ended.crossed || holdMs >= thresholdMs)
          log(ended.context, "released", {
            ...ended.origin,
            statement: ended.statement,
            statements: ended.statements,
            since: ended.started,
            holdMs,
          })
      }
    }
    try {
      const result = write()
      settle(false)
      return result
    } catch (error) {
      settle(true)
      throw error
    }
  }

  function log(
    context: Context.Context<never>,
    event: Event,
    details: Origin & { statement: string; statements?: number; since: number; holdMs: number },
  ) {
    Effect.runForkWith(context)(
      Effect.logWarning("sqlite write lock held", {
        "sqlite.hold": {
          event,
          ...identity(),
          ...(details.sessionID ? { sessionID: details.sessionID } : {}),
          ...(details.operation ? { operation: details.operation } : {}),
          statement: details.statement,
          ...(details.statements === undefined ? {} : { statements: details.statements }),
          since: new Date(details.since).toISOString(),
          holdMs: details.holdMs,
          thresholdMs,
        },
      }),
    )
  }
}

type Origin = { readonly operation?: string; readonly sessionID?: string }

// Span names are code identifiers; the SQL client's own spans say nothing about the caller.
function describe(span: Tracer.AnySpan | undefined): Origin {
  const names: string[] = []
  let sessionID: string | undefined
  for (let current = span; current; ) {
    if (current._tag !== "Span") break
    if (!current.name.startsWith("sql.") && names.length < 3) names.push(current.name.slice(0, 80))
    const value = current.attributes.get("session.id")
    if (!sessionID && typeof value === "string") sessionID = value
    current = Option.getOrUndefined(current.parent)
  }
  return {
    ...(names.length ? { operation: names.join(" < ") } : {}),
    ...(sessionID ? { sessionID } : {}),
  }
}
