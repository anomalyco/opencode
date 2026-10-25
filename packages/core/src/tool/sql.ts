import path from "path"
import { Effect, Schema } from "effect"
import { InstanceState } from "@/effect/instance-state"
import DESCRIPTION from "./sql.txt"
import * as Tool from "./tool"

const MAX_ROWS = 100
const DEFAULT_ROWS = 50

export const Parameters = Schema.Struct({
  query: Schema.optional(Schema.String).annotate({
    description: "The SQL statement to run. Required unless schema is true. Must be a single read-only statement.",
  }),
  schema: Schema.optional(Schema.Boolean).annotate({
    description: "When true, list tables and columns instead of running a query. Use this first to orient.",
  }),
  target: Schema.optional(Schema.String).annotate({
    description:
      "Optional connection target: a SQLite file path or a postgres://, postgresql://, mysql://, or mariadb:// URL. Defaults to the project configuration or environment.",
  }),
  limit: Schema.optional(Schema.Number).annotate({
    description: `Maximum number of rows to return. Defaults to ${DEFAULT_ROWS}, capped at ${MAX_ROWS}.`,
  }),
})

type Row = Record<string, unknown>

const FORBIDDEN =
  /\b(insert|update|delete|drop|create|alter|attach|detach|replace|truncate|grant|revoke|vacuum|reindex|merge|call|exec|execute|copy|set|lock|rename|import|load|into)\b/i

/**
 * Read-only statement validator. Strips comments and literals first so
 * injection payloads hidden inside strings do not trip (or dodge) the checks,
 * then requires a single SELECT/WITH/EXPLAIN/PRAGMA statement with no
 * write-capable keyword anywhere in it.
 */
export function validate(query: string): { ok: true } | { ok: false; reason: string } {
  const stripped = strip(query)
  if (stripped === undefined) return { ok: false, reason: "unterminated string literal or comment" }
  const body = stripped.trim().replace(/;\s*$/, "").trim()
  if (!body) return { ok: false, reason: "empty query" }
  if (body.includes(";")) return { ok: false, reason: "only a single statement is allowed" }
  const head = body.match(/^[a-z]+/i)?.[0]?.toUpperCase()
  if (head === "PRAGMA") {
    if (body.includes("=")) return { ok: false, reason: "PRAGMA assignments are not allowed" }
    return { ok: true }
  }
  if (head !== "SELECT" && head !== "WITH" && head !== "EXPLAIN") {
    return { ok: false, reason: "query must start with SELECT, WITH, EXPLAIN, or PRAGMA" }
  }
  const match = body.match(FORBIDDEN)
  if (match) return { ok: false, reason: `write-capable keyword is not allowed: ${match[0].toUpperCase()}` }
  return { ok: true }
}

/**
 * Replace string literals, quoted identifiers, dollar-quoted strings, and
 * comments with spaces. Returns undefined when a construct is unterminated so
 * the validator can reject instead of guessing.
 */
function strip(query: string): string | undefined {
  let out = ""
  let i = 0
  while (i < query.length) {
    const ch = query[i]
    if (ch === "-" && query[i + 1] === "-") {
      const end = query.indexOf("\n", i)
      if (end === -1) return out + " "
      out += " "
      i = end + 1
      continue
    }
    if (ch === "/" && query[i + 1] === "*") {
      const end = query.indexOf("*/", i + 2)
      if (end === -1) return undefined
      out += " "
      i = end + 2
      continue
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      const end = closing(query, i, ch)
      if (end === -1) return undefined
      out += " "
      i = end + 1
      continue
    }
    if (ch === "$") {
      const tag = query.slice(i).match(/^\$[a-zA-Z_]*\$/)?.[0]
      if (tag) {
        const end = query.indexOf(tag, i + tag.length)
        if (end === -1) return undefined
        out += " "
        i = end + tag.length
        continue
      }
    }
    out += ch
    i++
  }
  return out
}

/** Find the index of the quote closing the literal opened at `start`, honoring doubled-quote and backslash escapes. */
function closing(query: string, start: number, quote: string): number {
  let i = start + 1
  while (i < query.length) {
    if (query[i] === "\\") {
      i += 2
      continue
    }
    if (query[i] !== quote) {
      i++
      continue
    }
    if (query[i + 1] === quote) {
      i += 2
      continue
    }
    return i
  }
  return -1
}

export function classify(target: string): "sqlite" | "postgres" | "mysql" {
  if (/^postgres(ql)?:\/\//i.test(target)) return "postgres"
  if (/^(mysql|mariadb):\/\//i.test(target)) return "mysql"
  return "sqlite"
}

/** Strip credentials from a connection target so it is safe to echo back. */
export function sanitize(target: string): string {
  if (classify(target) === "sqlite") return target.replace(/^sqlite:\/\//, "").replace(/^sqlite:/, "")
  if (!URL.canParse(target)) return "database"
  const url = new URL(target)
  if (url.password) url.password = "redacted"
  return url.toString()
}

export function render(rows: Row[], total: number, limit: number): string {
  if (total === 0) return "no rows"
  const lines = rows.map((row) => JSON.stringify(row))
  if (total > limit) lines.push(`(showing first ${limit} of ${total} fetched rows)`)
  return lines.join("\n")
}

/** Group flat information-schema style rows into a per-table column listing. */
export function tables(rows: Row[]): string {
  if (rows.length === 0) return "no tables found"
  const grouped = new Map<string, string[]>()
  for (const row of rows) {
    const table = String(row.table_name)
    const columns = grouped.get(table) ?? []
    columns.push(`  ${String(row.column_name)} ${String(row.data_type)}`)
    grouped.set(table, columns)
  }
  return [...grouped.entries()].map((entry) => [entry[0], ...entry[1]].join("\n")).join("\n\n")
}

const SCHEMA_QUERY = {
  sqlite:
    "SELECT m.name AS table_name, p.name AS column_name, p.type AS data_type FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type IN ('table', 'view') AND m.name NOT LIKE 'sqlite_%' ORDER BY m.name, p.cid",
  postgres:
    "SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema NOT IN ('pg_catalog', 'information_schema') ORDER BY table_name, ordinal_position",
  mysql:
    "SELECT table_name AS table_name, column_name AS column_name, data_type AS data_type FROM information_schema.columns WHERE table_schema = DATABASE() ORDER BY table_name, ordinal_position",
}

async function sqlite(target: string, root: string, query: string): Promise<Row[]> {
  const file = target.replace(/^sqlite:\/\//, "").replace(/^sqlite:/, "")
  const resolved = path.isAbsolute(file) ? file : path.resolve(root, file)
  if (!(await Bun.file(resolved).exists())) throw new Error(`sqlite database not found: ${resolved}`)
  const mod = await import("bun:sqlite")
  const db = new mod.Database(resolved, { readonly: true })
  try {
    return db.query(query).all() as Row[]
  } finally {
    db.close()
  }
}

async function remote(target: string, query: string): Promise<Row[]> {
  const db = new Bun.SQL({ url: target, max: 1 })
  try {
    return (await db.unsafe(query)) as Row[]
  } finally {
    await db.close()
  }
}

export const SqlTool = Tool.define(
  "sql",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const ins = yield* InstanceState.context
          const query = params.query?.trim()
          if (!params.schema && !query) throw new Error("query is required unless schema is true")
          if (!params.schema && query) {
            const checked = validate(query)
            if (!checked.ok) throw new Error(`query rejected: ${checked.reason}`)
          }

          const configured = yield* Effect.promise(() => configTarget(ins.worktree))
          const target = params.target ?? configured ?? process.env["BOLT_SQL_URL"] ?? process.env["DATABASE_URL"]
          if (!target) {
            throw new Error(
              "no database target configured: pass target, add a url to .bolt/sql.json, or set BOLT_SQL_URL / DATABASE_URL",
            )
          }
          const kind = classify(target)

          yield* ctx.ask({
            permission: "sql",
            patterns: [params.schema ? "schema" : query!],
            always: ["*"],
            metadata: { target: sanitize(target), kind, schema: params.schema ?? false },
          })

          const statement = params.schema ? SCHEMA_QUERY[kind] : query!
          const rows =
            kind === "sqlite"
              ? yield* Effect.promise(() => sqlite(target, ins.worktree, statement))
              : yield* Effect.promise(() => remote(target, statement))

          if (params.schema) {
            return {
              title: sanitize(target),
              metadata: { kind, tables: true, rows: rows.length, capped: false },
              output: tables(rows),
            }
          }

          const limit = Math.min(Math.max(params.limit ?? DEFAULT_ROWS, 1), MAX_ROWS)
          return {
            title: sanitize(target),
            metadata: { kind, tables: false, rows: rows.length, capped: rows.length > limit },
            output: render(rows.slice(0, limit), rows.length, limit),
          }
        }).pipe(Effect.orDie),
    }
  }),
)

/** Read the connection url from .bolt/sql.json when present. */
async function configTarget(root: string): Promise<string | undefined> {
  const file = Bun.file(path.join(root, ".bolt", "sql.json"))
  if (!(await file.exists())) return undefined
  const config = await file.json()
  if (typeof config !== "object" || config === null) return undefined
  const url = (config as Row).url
  return typeof url === "string" ? url : undefined
}
