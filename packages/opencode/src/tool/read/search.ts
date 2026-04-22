import path from "path"
import z from "zod"
import { Tool } from "../shared/tool"
import { Instance } from "../../project/instance"
import { assertExternalDirectory } from "../external-directory"
import { Ripgrep } from "../../file/ripgrep"
import { Filesystem } from "../../util/filesystem"
import { Process } from "../../util/process"
import { abortAfterAny } from "../../util/abort"
import { blank, zero } from "../shared/shape"
import { defaultIgnoreGlobs } from "./shared"

const MAX_LINE_LENGTH = 2000
const SEARCH_TIMEOUT_MS = 20_000
const searchAllowed = {
  path: ["pattern", "path", "head_limit"],
  content: ["pattern", "path", "include", "context", "from_line", "to_line", "output_mode", "head_limit"],
} as const
const ENTRY = [
  /^package\.json$/,
  /^tsconfig(\..+)?\.json$/,
  /^bunfig\.toml$/,
  /^deno\.json$/,
  /^vite\.config\./,
  /^next\.config\./,
  /^nuxt\.config\./,
  /^astro\.config\./,
  /^svelte\.config\./,
  /^README\.md$/i,
  /^index\./,
  /^main\./,
  /^app\./,
  /^server\./,
  /^client\./,
  /^route\./,
] as const

function terms(pattern: string) {
  return [
    ...new Set(
      pattern
        .toLowerCase()
        .split(/[^a-z0-9_]+/)
        .filter((item) => item.length >= 2),
    ),
  ]
}

function rank(file: string, input: string, text?: string) {
  const base = path.basename(file).toLowerCase()
  const stem = path.basename(file, path.extname(file)).toLowerCase()
  const full = file.toLowerCase()
  const body = text?.toLowerCase()
  const parts = terms(input)
  const depth = file.split(path.sep).length
  let score = 0
  for (const item of parts) {
    if (base === item) score += 12
    if (stem === item) score += 14
    if (base.startsWith(item)) score += 8
    if (stem.startsWith(item)) score += 9
    if (base.includes(item)) score += 6
    if (stem.includes(item)) score += 7
    if (full.includes(`/${item}/`) || full.includes(`\\${item}\\`)) score += 4
    if (body?.includes(item)) score += 3
  }
  if (full.includes("/src/") || full.includes("\\src\\")) score += 2
  if (full.includes("/test") || full.includes("\\test") || full.includes(".test.") || full.includes(".spec."))
    score -= 2
  return score - depth * 0.01
}

function clip(line: string) {
  return line.length > MAX_LINE_LENGTH ? line.slice(0, MAX_LINE_LENGTH) + "..." : line
}

function timeoutError(input: SearchInput) {
  return new Error(
    `Search timed out after ${SEARCH_TIMEOUT_MS}ms for action=${input.action}. Narrow the path or pattern and try again.`,
  )
}

function bucket(file: string, root: string) {
  const rel = path.relative(root, file)
  if (!rel || rel === ".") return "."
  const [first] = rel.split(path.sep)
  return first || "."
}

function entry(file: string) {
  const base = path.basename(file)
  return ENTRY.some((pattern) => pattern.test(base))
}

function structure(files: string[], root: string) {
  const groups = new Map<string, number>()
  const entries = [] as string[]
  for (const file of files) {
    groups.set(bucket(file, root), (groups.get(bucket(file, root)) ?? 0) + 1)
    if (entry(file)) entries.push(file)
  }
  return {
    groups: [...groups.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([group, count]) => ({ group, count })),
    entrypoints: entries.sort((a, b) => a.localeCompare(b)),
  }
}

async function lines(file: string) {
  return (await Bun.file(file).text()).split(/\r?\n/)
}

export const PathSearchParametersSchema = z
  .object({
    action: z.literal("path").describe("Search action to run."),
    pattern: z.string().describe("Glob pattern for filesystem path matching."),
    path: z
      .preprocess(blank, z.string().optional())
      .describe("Directory to search in. Defaults to the current working directory."),
    head_limit: z
      .preprocess(zero, z.coerce.number().int().min(1).max(1000).optional())
      .describe("Maximum number of returned paths. Defaults to 100."),
  })
  .strict()

export const ContentSearchParametersSchema = z
  .object({
    action: z.literal("content").describe("Search action to run."),
    pattern: z.string().describe("Regex pattern for content search."),
    path: z
      .preprocess(blank, z.string().optional())
      .describe("Directory to search in. Defaults to the current working directory."),
    include: z.preprocess(blank, z.string().optional()).describe("Optional file include glob for content searches."),
    context: z
      .preprocess(zero, z.coerce.number().int().min(0).max(10).optional())
      .describe("Optional number of surrounding context lines for content output mode."),
    from_line: z
      .preprocess(zero, z.coerce.number().int().min(1).optional())
      .describe("Optional starting line filter for content searches."),
    to_line: z
      .preprocess(zero, z.coerce.number().int().min(1).optional())
      .describe("Optional ending line filter for content searches."),
    output_mode: z
      .enum(["files_with_matches", "content", "count"])
      .optional()
      .describe("Content search output mode. Defaults to files_with_matches."),
    head_limit: z
      .preprocess(zero, z.coerce.number().int().min(1).max(1000).optional())
      .describe("Maximum number of returned entries. Defaults to 100."),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.from_line && input.to_line && input.to_line < input.from_line) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["to_line"],
        message: "to_line must be greater than or equal to from_line",
      })
    }
  })

function pickPresent(input: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
}

function stripSearchInput(input: SearchParameters) {
  const allowed = new Set<string>(["action", ...searchAllowed[input.action]])
  return Object.fromEntries(
    Object.entries(input).filter(([key, value]) => value !== undefined && allowed.has(key)),
  )
}

function addIssues(ctx: z.RefinementCtx, error: z.ZodError) {
  for (const issue of error.issues) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: issue.path,
      message: issue.message,
    })
  }
}

export const SearchParametersSchema = z
  .object({
    action: z.enum(["path", "content"]).describe("Search action to run."),
    pattern: z.string().describe("Path glob or content regex, depending on action."),
    path: z.preprocess(blank, z.string().optional()).describe("Optional search root. Defaults to the current working directory."),
    include: z.preprocess(blank, z.string().optional()).describe("Optional include glob for content searches."),
    context: z
      .preprocess(zero, z.coerce.number().int().min(0).max(10).optional())
      .describe("Optional surrounding context lines for content output mode."),
    from_line: z
      .preprocess(zero, z.coerce.number().int().min(1).optional())
      .describe("Optional starting line filter for content searches."),
    to_line: z
      .preprocess(zero, z.coerce.number().int().min(1).optional())
      .describe("Optional ending line filter for content searches."),
    output_mode: z
      .enum(["files_with_matches", "content", "count"])
      .optional()
      .describe("Optional content search output mode."),
    head_limit: z
      .preprocess(zero, z.coerce.number().int().min(1).max(1000).optional())
      .describe("Optional maximum number of returned entries."),
  })
  .strict()
  .superRefine((input, ctx) => {
    const next = stripSearchInput(input)
    const parsed =
      input.action === "path"
        ? PathSearchParametersSchema.safeParse(next)
        : ContentSearchParametersSchema.safeParse(next)
    if (!parsed.success) addIssues(ctx, parsed.error)
  })

type SearchParameters = z.infer<typeof SearchParametersSchema>
type SearchInput = z.infer<typeof PathSearchParametersSchema> | z.infer<typeof ContentSearchParametersSchema>

function parseSearchInput(input: SearchParameters): SearchInput {
  const next = stripSearchInput(input)
  if (input.action === "path") return PathSearchParametersSchema.parse(next)
  return ContentSearchParametersSchema.parse(next)
}

function root(input: SearchInput) {
  const out = input.path ?? Instance.directory
  return path.isAbsolute(out) ? out : path.resolve(Instance.directory, out)
}

export const SearchTool = Tool.define<typeof SearchParametersSchema, Record<string, unknown>>("search", {
  description:
    "Unified local search tool. Choose exactly one mode shape: action=path finds candidate filesystem paths with relevance ranking, and action=content runs regex search over file contents with file, content, or count output modes. The selected action determines which fields are used. Irrelevant fields from the other search action are ignored, while required fields for the chosen action are still validated strictly. By default, common dependency/build noise is ignored for denser discovery results.",
  parameters: SearchParametersSchema,
  async execute(input, ctx) {
    const nextInput = parseSearchInput(input)
    const search = root(nextInput)
    await assertExternalDirectory(ctx, search, { kind: "directory" })
    await ctx.ask({
      permission: "search",
      patterns: [search],
      always: ["*"],
      metadata: {
        action: nextInput.action,
        pattern: nextInput.pattern,
        path: nextInput.path,
        include: "include" in nextInput ? nextInput.include : undefined,
        output_mode: "output_mode" in nextInput ? nextInput.output_mode : undefined,
      },
    })

    const limit = nextInput.head_limit ?? 100

    if (nextInput.action === "path") {
      const timeout = abortAfterAny(SEARCH_TIMEOUT_MS, ctx.abort)
      try {
        const glob = [nextInput.pattern, ...defaultIgnoreGlobs()]
        const files = [] as Array<{ path: string; mtime: number }>
        for await (const file of Ripgrep.files({ cwd: search, glob, signal: timeout.signal })) {
          const full = path.resolve(search, file)
          files.push({
            path: full,
            mtime: Filesystem.stat(full)?.mtime.getTime() ?? 0,
          })
        }
        files.sort((a, b) => rank(b.path, nextInput.pattern) - rank(a.path, nextInput.pattern) || b.mtime - a.mtime)
        const truncated = files.length > limit
        const list = truncated ? files.slice(0, limit) : files
        const summary = structure(
          files.map((item) => item.path),
          search,
        )
        const output = list.length
          ? list.map((item) => item.path).join("\n") +
            (summary.groups.length
              ? `\n\n(Groups: ${summary.groups
                  .slice(0, 5)
                  .map((item) => `${item.group} (${item.count})`)
                  .join(", ")})`
              : "") +
            (summary.entrypoints.length
              ? `\n(Entrypoints: ${summary.entrypoints
                  .slice(0, 5)
                  .map((item) => path.relative(search, item) || item)
                  .join(", ")})`
              : "") +
            (truncated
              ? `\n\n(Results truncated: showing top ${list.length} ranked matches out of ${files.length}. Narrow the path or pattern, or rerun with a higher head_limit.)`
              : "")
          : "No files found"
        return {
          title: path.relative(Instance.worktree, search),
          metadata: {
            action: nextInput.action as string,
            ranking: "relevance_then_mtime",
            groups: summary.groups,
            entrypoints: summary.entrypoints,
            count: files.length,
            shown: list.length,
            truncated,
          },
          output,
        }
      } catch (error) {
        if (timeout.signal.aborted && !ctx.abort.aborted) throw timeoutError(nextInput)
        throw error
      } finally {
        timeout.clearTimeout()
      }
    }

    const timeout = abortAfterAny(SEARCH_TIMEOUT_MS, ctx.abort)
    let raw = ""
    let err = ""
    let code = 0
    try {
      const rg = await Ripgrep.filepath()
      const args = ["-nH", "--hidden", "--no-messages", "--field-match-separator=|", "--regexp", nextInput.pattern]
      if (nextInput.include) args.push("--glob", nextInput.include)
      for (const glob of defaultIgnoreGlobs()) args.push("--glob", glob)
      args.push(".")
      const out = await Process.run([rg, ...args], {
        cwd: search,
        abort: timeout.signal,
        nothrow: true,
      })
      raw = out.stdout.toString()
      err = out.stderr.toString()
      code = out.code
    } catch (error) {
      if (timeout.signal.aborted && !ctx.abort.aborted) throw timeoutError(nextInput)
      throw error
    } finally {
      timeout.clearTimeout()
    }

    if (code === 1 || (code === 2 && !raw.trim())) {
      return {
        title: nextInput.pattern,
        metadata: {
          action: nextInput.action as string,
          output_mode: nextInput.output_mode ?? "files_with_matches",
          count: 0,
          shown: 0,
          truncated: false,
        },
        output: "No files found",
      }
    }
    if (code !== 0 && code !== 2) throw new Error(`ripgrep failed: ${err}`)

    const rows = raw
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap((line) => {
        const [filePath, lineNumStr, ...rest] = line.split("|")
        if (!filePath || !lineNumStr || rest.length === 0) return []
        const full = path.resolve(search, filePath)
        const stat = Filesystem.stat(full)
        if (!stat) return []
        return [
          {
            path: full,
            line: Number.parseInt(lineNumStr, 10),
            text: rest.join("|"),
            mtime: stat.mtime.getTime(),
          },
        ]
      })
      .filter((item) => (nextInput.from_line ? item.line >= nextInput.from_line : true))
      .filter((item) => (nextInput.to_line ? item.line <= nextInput.to_line : true))

    rows.sort(
      (a, b) =>
        rank(b.path, nextInput.pattern, b.text) - rank(a.path, nextInput.pattern, a.text) ||
        b.mtime - a.mtime ||
        a.line - b.line,
    )
    const mode = nextInput.output_mode ?? "files_with_matches"

    if (mode === "files_with_matches") {
      const files = [...new Set(rows.map((item) => item.path))]
      const truncated = files.length > limit
      const list = truncated ? files.slice(0, limit) : files
      return {
        title: nextInput.pattern,
        metadata: {
          action: nextInput.action as string,
          output_mode: mode,
          ranking: "relevance_then_mtime",
          count: files.length,
          shown: list.length,
          truncated,
        },
        output:
          list.join("\n") +
          (list.length === 0
            ? "No files found"
            : truncated
              ? `\n\n(Results truncated: showing ${limit} of ${files.length} files.)`
              : ""),
      }
    }

    if (mode === "count") {
      const seen = new Map<string, { count: number; mtime: number }>()
      for (const row of rows) {
        const hit = seen.get(row.path)
        if (hit) {
          hit.count += 1
          continue
        }
        seen.set(row.path, { count: 1, mtime: row.mtime })
      }
      const files = [...seen.entries()].map(([file, item]) => ({ file, ...item })).sort((a, b) => b.mtime - a.mtime)
      const truncated = files.length > limit
      const list = truncated ? files.slice(0, limit) : files
      return {
        title: nextInput.pattern,
        metadata: {
          action: nextInput.action as string,
          output_mode: mode,
          ranking: "relevance_then_mtime",
          count: files.length,
          shown: list.length,
          truncated,
        },
        output:
          (list.length ? list.map((item) => `${item.file}: ${item.count}`).join("\n") : "No files found") +
          (truncated ? `\n\n(Results truncated: showing ${limit} of ${files.length} files.)` : ""),
      }
    }

    const truncated = rows.length > limit
    const list = truncated ? rows.slice(0, limit) : rows
    const context = nextInput.context ?? 0
    const cache = new Map<string, string[]>()
    const output = list.length
      ? context === 0
        ? list.map((item) => `${item.path}:${item.line}: ${clip(item.text)}`).join("\n")
        : (
            await Promise.all(
              list.map(async (item) => {
                let file = cache.get(item.path)
                if (!file) {
                  file = await lines(item.path)
                  cache.set(item.path, file)
                }
                const start = Math.max(1, item.line - context)
                const end = Math.min(file.length, item.line + context)
                const block = [] as string[]
                for (let i = start; i <= end; i++) {
                  const mark = i === item.line ? ">" : " "
                  block.push(`${mark} ${i}: ${clip(file[i - 1] ?? "")}`)
                }
                return [`${item.path}:${item.line}`, ...block].join("\n")
              }),
            )
          ).join("\n\n")
      : "No files found"
    return {
      title: nextInput.pattern,
      metadata: {
        action: nextInput.action as string,
        output_mode: mode,
        ranking: "relevance_then_mtime",
        context,
        count: rows.length,
        shown: list.length,
        truncated,
      },
      output: output + (truncated ? `\n\n(Results truncated: showing ${limit} of ${rows.length} matches.)` : ""),
    }
  },
})
