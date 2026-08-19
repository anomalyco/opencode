#!/usr/bin/env bun
// Which tools are actually being called, from the session store.
//
// The question this exists to answer is one you cannot answer by watching: the
// agent calls the tools, not you. So "try it for a week and see what you reach
// for" is not a thing anyone can do. This reads what already happened.
//
// Reads the SQLite session databases directly rather than the HTTP API — the
// API only serves the running instance's directory, and the interesting
// question spans every session ever.
import { Database } from "bun:sqlite"
import fs from "fs"
import os from "os"
import path from "path"

const STORE = path.join(os.homedir(), ".local", "share", "opencode")

type Row = { tool: string; calls: number; recent: number; last: number }

function parseArgs() {
  const args = process.argv.slice(2)
  const value = (flag: string) => {
    const i = args.indexOf(flag)
    return i === -1 ? undefined : args[i + 1]
  }
  return {
    days: Number(value("--days") ?? 30),
    top: Number(value("--top") ?? 30),
    // Substring filter, e.g. `--match skein` for MCP traffic only.
    match: value("--match"),
    // Default is the channel you are running, since mixing channels muddies
    // the answer; --all when you want the whole store.
    all: args.includes("--all"),
    channel: value("--channel"),
    json: args.includes("--json"),
  }
}

function databases(opts: ReturnType<typeof parseArgs>): string[] {
  if (!fs.existsSync(STORE)) return []
  const all = fs
    .readdirSync(STORE)
    .filter((name) => name.startsWith("opencode-") && name.endsWith(".db"))
    .map((name) => path.join(STORE, name))
  if (opts.all) return all
  const channel = opts.channel ?? currentChannel()
  const wanted = path.join(STORE, `opencode-${channel}.db`)
  return all.filter((file) => file === wanted)
}

/** The db name is the git branch with `/` replaced — see the build script. */
function currentChannel(): string {
  const proc = Bun.spawnSync(["git", "rev-parse", "--abbrev-ref", "HEAD"])
  const branch = proc.success ? proc.stdout.toString().trim() : "dev"
  return branch.replace(/\//g, "-")
}

function collect(files: string[], since: number): Map<string, Row> {
  const rows = new Map<string, Row>()
  for (const file of files) {
    let db: Database
    try {
      db = new Database(file, { readonly: true })
    } catch {
      continue // a database being written by a live instance is not an error
    }
    try {
      const query = db.query<{ tool: string; calls: number; recent: number; last: number }, [number]>(`
        select json_extract(data,'$.tool') as tool,
               count(*) as calls,
               sum(case when time_created > ?1 then 1 else 0 end) as recent,
               max(time_created) as last
        from part
        where json_extract(data,'$.type') = 'tool' and tool is not null
        group by tool
      `)
      for (const row of query.all(since)) {
        const existing = rows.get(row.tool)
        if (!existing) rows.set(row.tool, { ...row })
        else {
          existing.calls += row.calls
          existing.recent += row.recent
          existing.last = Math.max(existing.last, row.last)
        }
      }
    } catch {
      // Older stores predate the part table or the json1 extension. Skipping a
      // database is right; failing the whole report because one is stale is not.
    } finally {
      db.close()
    }
  }
  return rows
}

function ago(ms: number): string {
  if (!ms) return "never"
  const days = Math.floor((Date.now() - ms) / 86_400_000)
  if (days === 0) return "today"
  if (days === 1) return "yesterday"
  return `${days}d ago`
}

const opts = parseArgs()
const files = databases(opts)
if (files.length === 0) {
  console.error(`no session databases found in ${STORE}${opts.all ? "" : " for this channel — try --all"}`)
  process.exit(1)
}

const since = Date.now() - opts.days * 86_400_000
let rows = [...collect(files, since).values()]
if (opts.match) rows = rows.filter((row) => row.tool.includes(opts.match!))
rows.sort((a, b) => b.calls - a.calls)

if (opts.json) {
  console.log(JSON.stringify({ databases: files.map((f) => path.basename(f)), days: opts.days, rows }, null, 2))
} else {
  const shown = rows.slice(0, opts.top)
  const width = Math.max(4, ...shown.map((row) => row.tool.length))
  console.log(
    `${files.length} database${files.length === 1 ? "" : "s"}: ${files.map((f) => path.basename(f)).join(", ")}\n`,
  )
  console.log(`${"tool".padEnd(width)}  ${"all".padStart(8)}  ${`${opts.days}d`.padStart(8)}  last`)
  console.log("-".repeat(width + 30))
  for (const row of shown) {
    console.log(
      `${row.tool.padEnd(width)}  ${String(row.calls).padStart(8)}  ${String(row.recent).padStart(8)}  ${ago(row.last)}`,
    )
  }
  if (rows.length > shown.length) console.log(`\n… ${rows.length - shown.length} more (--top ${rows.length})`)
  const total = rows.reduce((sum, row) => sum + row.calls, 0)
  const recent = rows.reduce((sum, row) => sum + row.recent, 0)
  console.log(`\ntotal: ${total} calls, ${recent} in the last ${opts.days}d`)
}
