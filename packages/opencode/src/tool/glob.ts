import path from "path"
import z from "zod"
import { Effect } from "effect"
import { InstanceState } from "@/effect"
import { Fff } from "../file/fff"
import { Glob } from "@opencode-ai/shared/util/glob"
import { assertExternalDirectoryEffect } from "./external-directory"
import DESCRIPTION from "./glob.txt"
import * as Tool from "./tool"

type Row = {
  path: string
  rel: string
}

function include(pattern: string) {
  const val = pattern.trim().replaceAll("\\", "/")
  if (!val) return "*"
  const flat = val.replaceAll("**/", "").replaceAll("/**", "/")
  const idx = flat.lastIndexOf("/")
  if (idx < 0) return flat
  const dir = flat.slice(0, idx + 1)
  const glob = flat.slice(idx + 1)
  if (!glob) return dir
  return `${dir} ${glob}`
}

function words(text: string) {
  return text.trim().split(/\s+/).filter(Boolean)
}

function norm(text: string) {
  return text.replaceAll("\\", "/")
}

function hidden(rel: string) {
  return norm(rel).split("/").includes(".git")
}

function broad(pattern: string) {
  const val = norm(pattern.trim())
  if (!val) return true
  if (["*", "**", "**/*", "./**", "./**/*"].includes(val)) return true
  return /^(\*\*\/)?\*$/.test(val)
}

function allowed(pattern: string, rel: string) {
  if (Glob.match(pattern, rel)) return true
  const file = rel.split("/").at(-1) ?? rel
  return Glob.match(pattern, file)
}

function pick(items: { relativePath: string }[], cwd: string) {
  return items
    .map((item) => ({
      path: path.resolve(cwd, item.relativePath),
      rel: norm(item.relativePath),
    }))
    .filter((item) => !hidden(item.rel))
}

function top(rows: Row[]) {
  const out = new Map<string, number>()
  for (const row of rows) {
    const parts = row.rel.split("/")
    const key = parts.length < 2 ? "." : parts.slice(0, Math.min(2, parts.length - 1)).join("/") + "/"
    out.set(key, (out.get(key) ?? 0) + 1)
  }
  return Array.from(out.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 12)
}

async function scan(pattern: string, dir: string) {
  const direct = await Glob.scan(pattern, {
    cwd: dir,
    absolute: true,
    include: "file",
    dot: true,
  })
  const out =
    direct.length > 0
      ? direct
      : await Glob.scan(`**/${pattern}`, {
          cwd: dir,
          absolute: true,
          include: "file",
          dot: true,
        })
  return out
    .map((file) => ({
      path: file,
      rel: norm(path.relative(dir, file)),
    }))
    .filter((item) => !hidden(item.rel))
}

export const GlobTool = Tool.define(
  "glob",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: z.object({
      pattern: z.string().describe("The glob pattern to match files against"),
      path: z
        .string()
        .optional()
        .describe(
          `The directory to search in. If not specified, the current working directory will be used. IMPORTANT: Omit this field to use the default directory. DO NOT enter "undefined" or "null" - simply omit it for the default behavior. Must be a valid directory path if provided.`,
        ),
    }),
    execute: (params: { pattern: string; path?: string }, ctx: Tool.Context) =>
      Effect.gen(function* () {
        const ins = yield* InstanceState.context
        yield* ctx.ask({
          permission: "glob",
          patterns: [params.pattern],
          always: ["*"],
          metadata: {
            pattern: params.pattern,
            path: params.path,
          },
        })

        let dir = params.path ?? ins.directory
        dir = path.isAbsolute(dir) ? dir : path.resolve(ins.directory, dir)
        yield* assertExternalDirectoryEffect(ctx, dir, { kind: "directory" })

        const limit = 100
        const wide = broad(params.pattern)
        const size = wide ? 400 : limit + 1

        const first = yield* Effect.promise(() =>
          Fff.files({
            cwd: dir,
            query: include(params.pattern),
            size,
            current: path.join(dir, ".opencode"),
          }),
        )

        let fallback = false
        let rows = pick(first.items, dir).filter((row) => allowed(params.pattern, row.rel))
        if (!rows.length) {
          const list = words(params.pattern)
          if (list.length >= 3) {
            const short = list.slice(0, 2).join(" ")
            const next = yield* Effect.promise(() =>
              Fff.files({
                cwd: dir,
                query: include(short),
                size,
                current: path.join(dir, ".opencode"),
              }),
            )
            rows = pick(next.items, dir).filter((row) => allowed(params.pattern, row.rel))
          }
        }
        if (!rows.length) {
          fallback = true
          rows = (yield* Effect.promise(() => scan(params.pattern, dir))).filter((row) =>
            allowed(params.pattern, row.rel),
          )
        }

        const truncated = rows.length > limit
        const files = rows.slice(0, limit).map((row) => row.path)

        const output = []
        if (files.length === 0) output.push("No files found")
        if (files.length > 0) {
          output.push(...files)
          if (wide && truncated) {
            const dirs = top(rows)
            if (dirs.length > 0) {
              output.push("")
              output.push("Top directories in this result set:")
              output.push(...dirs.map(([dir, count]) => `${dir} (${count})`))
            }
          }
          if (fallback) {
            output.push("")
            output.push("(Used filesystem glob fallback for this pattern.)")
          }
          if (truncated) {
            output.push("")
            output.push(
              `(Results are truncated: showing first ${limit} results. Consider using a more specific path or pattern.)`,
            )
          }
        }

        return {
          title: path.relative(ins.worktree, dir),
          metadata: {
            count: files.length,
            truncated,
          },
          output: output.join("\n"),
        }
      }).pipe(Effect.orDie),
  }),
)
