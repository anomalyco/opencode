import path from "path"
import z from "zod"
import { Effect } from "effect"
import { InstanceState } from "@/effect"
import { Fff } from "../file/fff"
import type { GrepMode } from "@ff-labs/fff-node"
import { Glob } from "../util/glob"
import { assertExternalDirectoryEffect } from "./external-directory"
import DESCRIPTION from "./grep.txt"
import * as Tool from "./tool"

const MAX_LINE = 180
const MAX_MATCH = 100
const MAX_DEF_FIRST = 8
const MAX_DEF_NEXT = 5

function isRegex(pattern: string) {
  return /[.*+?^${}()|[\]\\]/.test(pattern)
}

function isConstraint(text: string) {
  return text.startsWith("!") || text.startsWith("*") || text.endsWith("/")
}

function clean(text: string) {
  return text.replaceAll(":", "").replaceAll("-", "").replaceAll("_", "").toLowerCase().trim()
}

function include(text?: string) {
  if (!text) return undefined
  const val = text.trim().replaceAll("\\", "/")
  if (!val) return undefined
  const flat = val.replaceAll("**/", "").replaceAll("/**", "/")
  const idx = flat.lastIndexOf("/")
  if (idx < 0) return flat
  const dir = flat.slice(0, idx + 1)
  const glob = flat.slice(idx + 1)
  if (!glob) return dir
  return `${dir} ${glob}`
}

function query(pattern: string, inc?: string) {
  if (!inc) return pattern
  return `${inc} ${pattern}`.trim()
}

function norm(text: string) {
  return text.replaceAll("\\", "/")
}

function allowed(hit: Fff.Hit, inc?: string) {
  if (!inc) return true
  const rel = norm(hit.relativePath)
  if (Glob.match(inc, rel)) return true
  return Glob.match(inc, norm(hit.fileName))
}

function def(line: string) {
  const text = line.trim()
  if (!text) return false
  return /^(export\s+)?(default\s+)?(async\s+)?(function|class|interface|type|enum|const|let|var)\b/.test(text)
}

function imp(line: string) {
  return /^(import\b|export\s+\{.*\}\s+from\b|use\b|#include\b|require\()/.test(line.trim())
}

function line(text: string, ranges: [number, number][]) {
  const trim = text.trim()
  if (trim.length <= MAX_LINE) return trim
  const first = ranges[0]
  if (!first) return trim.slice(0, MAX_LINE - 3) + "..."
  const start = Math.max(0, first[0] - Math.floor(MAX_LINE / 3))
  const end = Math.min(trim.length, start + MAX_LINE)
  const body = trim.slice(start, end)
  const pre = start > 0 ? "..." : ""
  const post = end < trim.length ? "..." : ""
  return pre + body + post
}

function group(rows: Item[]) {
  const out = new Map<string, Item[]>()
  for (const row of rows) {
    const list = out.get(row.hit.path)
    if (list) {
      list.push(row)
      continue
    }
    out.set(row.hit.path, [row])
  }
  return out
}

type Item = {
  hit: Fff.Hit
  def: boolean
  imp: boolean
  idx: number
}

async function run(input: {
  cwd: string
  pattern: string
  inc?: string
  mode: GrepMode
  max: number
  before: number
  after: number
}) {
  const first = await Fff.grep({
    cwd: input.cwd,
    query: query(input.pattern, include(input.inc)),
    mode: input.mode,
    max: input.max,
    before: input.before,
    after: input.after,
  })
  const head = first.items.filter((hit) => allowed(hit, input.inc))
  if (head.length) return { out: first, hits: head }
  if (!input.inc) return { out: first, hits: head }
  const raw = await Fff.grep({
    cwd: input.cwd,
    query: input.pattern,
    mode: input.mode,
    max: input.max,
    before: input.before,
    after: input.after,
  })
  return {
    out: raw,
    hits: raw.items.filter((hit) => allowed(hit, input.inc)),
  }
}

export const GrepTool = Tool.define(
  "grep",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: z.object({
      pattern: z.string().describe("The regex pattern to search for in file contents"),
      path: z.string().optional().describe("The directory to search in. Defaults to the current working directory."),
      include: z.string().optional().describe('File pattern to include in the search (e.g. "*.js", "*.{ts,tsx}")'),
    }),
    execute: (params: { pattern: string; path?: string; include?: string }, ctx: Tool.Context) =>
      Effect.gen(function* () {
        if (!params.pattern) {
          throw new Error("pattern is required")
        }

        yield* ctx.ask({
          permission: "grep",
          patterns: [params.pattern],
          always: ["*"],
          metadata: {
            pattern: params.pattern,
            path: params.path,
            include: params.include,
          },
        })

        const ins = yield* InstanceState.context
        let dir = params.path ?? ins.directory
        dir = path.isAbsolute(dir) ? dir : path.resolve(ins.directory, dir)
        yield* assertExternalDirectoryEffect(ctx, dir, { kind: "directory" })

        const mode: GrepMode = isRegex(params.pattern) ? "regex" : "plain"
        const exact = yield* Effect.promise(() =>
          run({
            cwd: dir,
            pattern: params.pattern,
            inc: params.include,
            mode,
            max: 10,
            before: 0,
            after: 4,
          }),
        )

        let phase = "exact"
        let note = ""
        let warn = exact.out.regexFallbackError
        let hits = exact.hits

        if (!hits.length) {
          const words = params.pattern.trim().split(/\s+/).filter(Boolean)
          if (words.length >= 2 && !isConstraint(words[0])) {
            const next = words.slice(1).join(" ")
            const step = yield* Effect.promise(() =>
              run({
                cwd: dir,
                pattern: next,
                inc: params.include,
                mode: isRegex(next) ? "regex" : "plain",
                max: 10,
                before: 0,
                after: 4,
              }),
            )
            warn = warn ?? step.out.regexFallbackError
            if (step.hits.length > 0 && step.hits.length <= 10) {
              phase = "broad"
              note = `0 exact matches. Broadened query \`${next}\`:`
              hits = step.hits
            }
          }
        }

        if (!hits.length) {
          const fuzzy = clean(params.pattern)
          if (fuzzy) {
            const step = yield* Effect.promise(() =>
              run({
                cwd: dir,
                pattern: fuzzy,
                inc: params.include,
                mode: "fuzzy",
                max: 3,
                before: 0,
                after: 2,
              }),
            )
            if (step.hits.length) {
              phase = "fuzzy"
              note = `0 exact matches. ${step.hits.length} approximate:`
              hits = step.hits
            }
          }
        }

        if (!hits.length && params.pattern.includes("/")) {
          const files = yield* Effect.promise(() =>
            Fff.files({
              cwd: dir,
              query: params.pattern,
              size: 1,
            }),
          )
          const row = files.items[0]
          const score = files.scores[0]
          if (row && score && score.baseScore > params.pattern.length * 10) {
            return {
              title: params.pattern,
              metadata: { matches: 0, truncated: false },
              output: `0 content matches. But there is a relevant file path:\n${row.path}`,
            }
          }
        }

        if (!hits.length) {
          return {
            title: params.pattern,
            metadata: { matches: 0, truncated: false },
            output: "No files found",
          }
        }

        const rows: Item[] = hits.map((hit, idx) => ({
          hit,
          idx,
          def: def(hit.lineContent),
          imp: imp(hit.lineContent),
        }))
        const hasDef = rows.some((row) => row.def)
        const show = hasDef ? rows.filter((row) => !row.imp || row.def) : rows
        show.sort((a, b) => {
          const ak = a.def ? 0 : a.imp ? 2 : 1
          const bk = b.def ? 0 : b.imp ? 2 : 1
          if (ak !== bk) return ak - bk
          return a.idx - b.idx
        })

        const total = show.length
        const trim = show.slice(0, MAX_MATCH)
        const over = total > MAX_MATCH
        const files = new Set(trim.map((row) => row.hit.path)).size
        const budget = files <= 3 ? 5000 : files <= 8 ? 3500 : 2500
        const read = (trim.find((row) => row.def) ?? trim[0]).hit.path

        const out: string[] = []
        if (phase === "exact") out.push(`Found ${total} matches${over ? ` (showing first ${MAX_MATCH})` : ""}`)
        if (phase !== "exact") out.push(note)
        out.push(`Read ${read}`)
        if (warn) out.push(`! regex failed: ${warn}`)

        const by = group(trim)
        let used = out.join("\n").length
        let cut = false
        let firstDef = true
        let shown = 0
        for (const [file, list] of by.entries()) {
          const chunk = ["", `${file}:`]
          let add = 0
          for (const row of list) {
            add++
            chunk.push(`  Line ${row.hit.lineNumber}: ${line(row.hit.lineContent, row.hit.matchRanges)}`)
            if (!row.def) continue
            const max = firstDef ? MAX_DEF_FIRST : MAX_DEF_NEXT
            firstDef = false
            for (const extra of (row.hit.contextAfter ?? []).slice(0, max)) {
              chunk.push(`    ${line(extra, [])}`)
            }
          }
          const text = chunk.join("\n")
          if (used + text.length > budget && shown > 0) {
            cut = true
            break
          }
          out.push(...chunk)
          used += text.length
          shown += add
        }

        if (over || cut) {
          out.push("")
          out.push(`(Results truncated: showing first ${shown} results. Consider using a more specific path or pattern.)`)
        }

        return {
          title: params.pattern,
          metadata: {
            matches: total,
            truncated: over || cut,
          },
          output: out.join("\n"),
        }
      }).pipe(Effect.orDie),
  }),
)
