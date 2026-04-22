import path from "path"
import { createTwoFilesPatch, diffLines } from "diff"
import z from "zod"
import { Bus } from "@/bus"
import { File } from "@/file"
import { FileTime } from "@/file/time"
import { FileWatcher } from "@/file/watcher"
import { Ripgrep } from "@/file/ripgrep"
import { Format } from "@/format"
import { LSP } from "@/lsp"
import { LSPClient } from "@/lsp/client"
import { Instance } from "@/project/instance"
import { assertExternalDirectory } from "@/tool/external-directory"
import { Tool } from "@/tool/shared/tool"
import { trimDiff } from "@/tool/edit/index"
import { appendCodeActions, appendDiagnostics, appendTouchWarnings, withTouchedFiles } from "@/tool/edit/lsp"
import { Filesystem } from "@/util/filesystem"
import { Process } from "@/util/process"
import { IGNORE_PATTERNS } from "@/tool/read/shared"

const DESCRIPTION = `- Replace the same pattern across many files in a workspace or directory tree
- Supports \`literal\`, \`regex\`, and \`identifier\` matching modes
- Supports case-sensitive or case-insensitive matching, optional whole-word matching, include/exclude globs, per-file first-match or all-match replacement, and \`dry_run\` preview
- Returns grouped discovery summaries in dry-run mode, and writes all approved replacements in one bulk operation otherwise
- Prefer this when the tool should discover affected files automatically across a repo or subtree
- Do not use this for single-file contextual edits, full-file rewrites, semantic renames, or filesystem topology changes`

function esc(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function ident(text: string) {
  return /^[A-Za-z_$][\w$]*$/.test(text)
}

function modePattern(input: {
  oldString: string
  mode: "literal" | "regex" | "identifier"
  case_sensitive: boolean
  whole_word?: boolean
}) {
  if (input.mode === "identifier") {
    if (!ident(input.oldString)) throw new Error("identifier mode requires oldString to be a valid identifier")
    const source = esc(input.oldString)
    return {
      pattern: `(?<![\\w$])${source}(?![\\w$])`,
      search: source,
      flags: `${input.case_sensitive ? "" : "i"}`,
    }
  }

  const source = input.mode === "literal" ? esc(input.oldString) : input.oldString
  const pattern = input.case_sensitive
    ? input.whole_word
      ? `\\b(?:${source})\\b`
      : source
    : input.whole_word
      ? `(?i:\\b(?:${source})\\b)`
      : `(?i:${source})`
  const flags = `${input.case_sensitive ? "" : "i"}`
  return { pattern, search: pattern, flags }
}

type ReplaceMeta = {
  count: number
  matches: number
  truncated: boolean
  diagnostics: Record<string, LSPClient.Diagnostic[]>
  preview: boolean
  lsp: { touches: LSP.TouchStatus[] }
  files: Array<{
    filePath: string
    relativePath: string
    type: "update"
    patch: string
    additions: number
    deletions: number
  }>
}

const WorkspaceReplaceParameters = z.object({
  oldString: z.string().describe("Exact text or pattern to replace across matching files."),
  newString: z.string().describe("Replacement text."),
  path: z.string().optional().describe("Directory to search. Defaults to the current working directory."),
  include: z.array(z.string()).optional().describe("Optional glob filters such as ['*.ts', '*.tsx'] or ['src/**']"),
  exclude: z.array(z.string()).optional().describe("Optional glob patterns to exclude from replacement."),
  mode: z
    .enum(["literal", "regex", "identifier"])
    .default("literal")
    .describe("How to interpret oldString during matching."),
  case_sensitive: z.boolean().default(true).describe("Whether matching should be case sensitive."),
  whole_word: z.boolean().optional().describe("Match whole words only."),
  replaceAll: z
    .boolean()
    .default(true)
    .describe("Replace all occurrences per file. If false, only the first occurrence per file is replaced."),
  dry_run: z.boolean().optional().describe("Preview matching files and sample lines without modifying anything."),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(500)
    .default(100)
    .describe("Maximum number of files to modify in one call."),
})

export const WorkspaceReplaceTool = Tool.define<typeof WorkspaceReplaceParameters, ReplaceMeta>("workspace_replace", {
  description: DESCRIPTION,
  parameters: WorkspaceReplaceParameters,
  async execute(input, ctx) {
    if (input.oldString === "") throw new Error("oldString must not be empty")
    if (input.oldString === input.newString) throw new Error("oldString and newString are identical")

    const root = path.isAbsolute(input.path ?? ".") ? input.path ?? "." : path.resolve(Instance.directory, input.path ?? ".")
    await assertExternalDirectory(ctx, root, { kind: "directory" })

    const built = modePattern(input)
    const reg = new RegExp(built.pattern, `${built.flags}${input.replaceAll ? "g" : ""}`)
    if (new RegExp(reg.source, reg.flags.replaceAll("g", "")).test("")) {
      throw new Error("Replacement pattern must not match the empty string")
    }

    const rg = await Ripgrep.filepath()
    const args = [rg, "--json", "--hidden", "--no-messages", "--glob=!.git/*"]
    for (const item of IGNORE_PATTERNS) args.push(`--glob=!${item}*`)
    for (const item of input.include ?? []) args.push(`--glob=${item}`)
    for (const item of input.exclude ?? []) args.push(`--glob=!${item}`)
    args.push("--regexp", built.search, ".")

    const hit = await Process.text(args, {
      cwd: root,
      abort: ctx.abort,
      nothrow: true,
    })

    if (hit.code === 1 || !hit.text.trim()) {
      return {
        title: path.relative(Instance.worktree, root),
        metadata: {
          count: 0,
          matches: 0,
          truncated: false,
          diagnostics: {},
          preview: input.dry_run === true,
          lsp: { touches: [] },
          files: [],
        } satisfies ReplaceMeta,
        output: "No files found",
      }
    }

    const rows = hit.text
      .split(/\r?\n/)
      .filter(Boolean)
      .map((item) => JSON.parse(item) as Ripgrep.Result)
      .filter((item): item is Ripgrep.Match => item.type === "match")
    const seen = new Set<string>()
    const sample = new Map<string, { count: number; lines: Array<{ line: number; text: string }> }>()
    for (const item of rows) {
      const file = path.resolve(root, item.data.path.text)
      const next = sample.get(file) ?? { count: 0, lines: [] }
      next.count += item.data.submatches.length || 1
      if (next.lines.length < 3) {
        next.lines.push({ line: item.data.line_number, text: item.data.lines.text.trimEnd() })
      }
      sample.set(file, next)
      seen.add(file)
    }
    const all = [...seen]
    const files = all.slice(0, input.limit)
    const cut = all.length > files.length
    const matches = all.reduce((sum, file) => sum + (sample.get(file)?.count ?? 0), 0)

    if (input.dry_run) {
      const out = files.flatMap((file) => {
        const item = sample.get(file)
        const rel = path.relative(Instance.worktree, file).replaceAll("\\", "/")
        return [
          `${rel} (${item?.count ?? 0} matches)`,
          ...(item?.lines.map((line) => `  Line ${line.line}: ${line.text}`) ?? []),
          "",
        ]
      })
      return {
        title: path.relative(Instance.worktree, root),
        metadata: {
          count: files.length,
          matches,
          truncated: cut,
          diagnostics: {},
          preview: true,
          lsp: { touches: [] },
          files: [],
        } satisfies ReplaceMeta,
        output: `Matched ${all.length} files and ${matches} matches${cut ? ` (showing first ${files.length} files)` : ""}\n\n${out.join("\n").trim()}`,
      }
    }

    const changes: Array<{
      file: string
      old: string
      next: string
      diff: string
      additions: number
      deletions: number
      matches: number
    }> = []
    let total = ""

    for (const file of files) {
      await FileTime.withLock(file, async () => {
        const old = await Filesystem.readText(file)
        await FileTime.read(ctx.sessionID, file)
        const next = old.replace(reg, input.newString)
        if (next === old) return
        const diff = trimDiff(createTwoFilesPatch(file, file, old, next))
        let additions = 0
        let deletions = 0
        for (const item of diffLines(old, next)) {
          if (item.added) additions += item.count || 0
          if (item.removed) deletions += item.count || 0
        }
        changes.push({
          file,
          old,
          next,
          diff,
          additions,
          deletions,
          matches: sample.get(file)?.count ?? 0,
        })
        total += diff + "\n"
      })
    }

    if (changes.length === 0) {
      return {
        title: path.relative(Instance.worktree, root),
        metadata: {
          count: 0,
          matches: 0,
          truncated: cut,
          diagnostics: {},
          preview: false,
          lsp: { touches: [] },
          files: [],
        } satisfies ReplaceMeta,
        output: "No files found",
      }
    }

    const rel = changes.map((item) => path.relative(Instance.worktree, item.file).replaceAll("\\", "/"))
    await ctx.ask({
      permission: "edit",
      patterns: rel,
      always: ["*"],
      metadata: {
        filepath: rel.join(", "),
        diff: total,
        files: changes.map((item) => ({
          filePath: item.file,
          relativePath: path.relative(Instance.worktree, item.file).replaceAll("\\", "/"),
          type: "update",
          patch: item.diff,
          additions: item.additions,
          deletions: item.deletions,
        })),
      },
    })

    for (const item of changes) {
      await FileTime.withLock(item.file, async () => {
        await FileTime.assert(ctx.sessionID, item.file)
        await Filesystem.write(item.file, item.next)
        await Format.file(item.file)
        Bus.publish(File.Event.Edited, { file: item.file })
        await Bus.publish(FileWatcher.Event.Updated, { file: item.file, event: "change" })
        await FileTime.read(ctx.sessionID, item.file)
      })
    }

    const changed = changes.map((item) => item.file)
    const changedMatches = changes.reduce((sum, item) => sum + item.matches, 0)
    let output = `Success. Updated ${changes.length} files and ${changedMatches} matches:\n${changes
      .map((item) => `M ${path.relative(Instance.worktree, item.file).replaceAll("\\", "/")}`)
      .join("\n")}`
    const diagnostics: Record<string, LSPClient.Diagnostic[]> = {}
    let touches: LSP.TouchStatus[] = []

    await withTouchedFiles(changed, async (next) => {
      touches = next
      const result = await LSP.diagnostics()
      Object.assign(diagnostics, result)
      output = appendTouchWarnings(output, touches)
      output = appendDiagnostics(output, result, changed)
      output = await appendCodeActions(output, result, changed)
    })

    if (cut) {
      output += `\n\n(Results truncated: modified first ${changes.length} files out of ${all.length} matched files.)`
    }

    return {
      title: path.relative(Instance.worktree, root),
      metadata: {
        count: changes.length,
        matches: changedMatches,
        truncated: cut,
        diagnostics,
        preview: false,
        lsp: { touches },
        files: changes.map((item) => ({
          filePath: item.file,
          relativePath: path.relative(Instance.worktree, item.file).replaceAll("\\", "/"),
          type: "update" as const,
          patch: item.diff,
          additions: item.additions,
          deletions: item.deletions,
        })),
      } satisfies ReplaceMeta,
      output,
    }
  },
})
