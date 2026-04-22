// the approaches in this edit tool are sourced from
// https://github.com/cline/cline/blob/main/evals/diff-edits/diff-apply/diff-06-23-25.ts
// https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/utils/editCorrector.ts
// https://github.com/cline/cline/blob/main/evals/diff-edits/diff-apply/diff-06-26-25.ts

import z from "zod"
import * as path from "path"
import { rm } from "fs/promises"
import { Tool } from "../shared/tool"
import { LSP } from "../../lsp"
import { LSPClient } from "../../lsp/client"
import { createTwoFilesPatch, diffLines } from "diff"
import { File } from "../../file"
import { FileWatcher } from "../../file/watcher"
import { Bus } from "../../bus"
import { Format } from "../../format"
import { FileTime } from "../../file/time"
import { Filesystem } from "../../util/filesystem"
import { Instance } from "../../project/instance"
import { Snapshot } from "@/snapshot"
import { assertExternalDirectory } from "../external-directory"
import { appendCodeActions, appendDiagnostics, appendTouchWarnings, applyRenamePlan, tryRenamePlan, withTouchedFiles } from "./lsp"
import { dataEditParameters, executeDataEdit } from "./structured/data-edit"
import { executeFrontmatterEdit, frontmatterEditParameters } from "./structured/frontmatter-edit"
import { executeMarkdownEdit, markdownEditParameters } from "./structured/markdown-edit"

const DESCRIPTION = `Default mutation tool for existing files. Use it for exact string replacements, sequential same-file edits, structured single-file updates, and semantic rename upgrades when LSP can apply them safely.

Structured modes:
- Set \`mode\` to \`data\`, \`frontmatter\`, or \`markdown\` to route the edit through the matching structure-aware engine instead of raw text replacement.
- In structured modes, keep using \`filePath\` but provide the mode-specific fields (\`pointer\`/\`action\`/\`value\`, or \`heading\`/\`content\`/\`position\`, etc.) rather than \`oldString\` / \`newString\`.

Selection guidance:
- Prefer \`edit\` for existing-file mutations where you are transforming content already on disk.
- Prefer \`edit\` over \`write\` when only part of an existing file should change.
- Prefer \`edit\` over \`apply_patch\` when the change stays inside one logical file, even if it needs multiple sequential edits.
- Use \`write\` only when you already know the complete final file contents.
- Use \`apply_patch\` only when the safest representation is a multi-file patch or file move/delete set.
- Use \`path_edit\` only for filesystem topology operations such as mkdir, rename, copy, move, or delete.
- Rename-like edits may be upgraded to a semantic LSP rename automatically when the file and server support it. If not, \`edit\` falls back to the normal text lane.

Usage:
- You must inspect the target file at least once in the conversation before editing it. This tool will error if you attempt an edit without first reading or inspecting the file contents.
- When editing text from inspected file output, ensure you preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix format is: line number + colon + space (e.g., \`1: \`). Everything after that space is the actual file content to match. Never include any part of the line number prefix in the oldString or newString.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- Only use emojis if the user explicitly requests it. Avoid adding emojis to files unless asked.
- The edit will FAIL if \`oldString\` is not found in the file with an error "oldString not found in content".
- The edit will FAIL if \`oldString\` is found multiple times in the file with an error "Found multiple matches for oldString. Provide more surrounding lines in oldString to identify the correct match." Either provide a larger string with more surrounding context to make it unique or use \`replaceAll\` to change every instance of \`oldString\`. 
- Use \`replaceAll\` for replacing and renaming strings across the file. This parameter is useful if you want to rename a variable for instance.
- For multiple sequential edits on one file, use the \`edits\` array instead of \`oldString\` / \`newString\`. Each item follows the same rules as a normal edit and all edits must target the same outer \`filePath\`.
- When \`edits\` is provided, a top-level \`replaceAll\` acts as the default for nested edits that do not set their own \`replaceAll\` value.
- Batch edits are atomic: if any nested edit fails validation or replacement, none of the file changes are written.
- If extra fields from another edit mode appear in the same call, \`edit\` keeps only the fields that match the chosen mode or batch shape and ignores the rest.`

type EditMode = "data" | "frontmatter" | "markdown"

function normalizeLineEndings(text: string): string {
  return text.replaceAll("\r\n", "\n")
}

function detectLineEnding(text: string): "\n" | "\r\n" {
  return text.includes("\r\n") ? "\r\n" : "\n"
}

function convertToLineEnding(text: string, ending: "\n" | "\r\n"): string {
  if (ending === "\n") return text
  return text.replaceAll("\n", "\r\n")
}

type EditResultMetadata = {
  diagnostics?: Record<string, Record<string, any>[]>
  diff?: string
  filediff?: Snapshot.FileDiff
  results?: EditResultMetadata[]
  mode?: EditMode
  filepath?: string
}

const batchItemParameters = z
  .object({
    filePath: z
      .string()
      .optional()
      .describe("Optional compat file path; when present it must match the outer filePath"),
    oldString: z.string().describe("The text to replace"),
    newString: z.string().describe("The text to replace it with (must be different from oldString)"),
    replaceAll: z.boolean().optional().describe("Replace all occurrences of oldString (default false)"),
  })
  .strict()

const batchEditParameters = z
  .object({
    filePath: z.string().describe("The absolute path to the file to modify"),
    replaceAll: z.boolean().optional().describe("Default replaceAll behavior for nested edits"),
    edits: z.array(batchItemParameters).min(1).describe("Sequential edit operations to perform on the same file"),
  })
  .superRefine((params, ctx) => {
    for (const [index, edit] of params.edits.entries()) {
      if (edit.filePath && edit.filePath !== params.filePath) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Each edit.filePath must match the outer filePath when provided",
          path: ["edits", index, "filePath"],
        })
      }
    }
  })
  .strict()

const singleEditParameters = z
  .object({
    filePath: z.string().describe("The absolute path to the file to modify"),
    oldString: z.string().describe("The text to replace"),
    newString: z.string().describe("The text to replace it with (must be different from oldString)"),
    replaceAll: z.boolean().optional().describe("Replace all occurrences of oldString (default false)"),
  })
  .strict()

const dataModeParameters = z
  .object({
    mode: z.literal("data"),
    filePath: z.string().describe("The absolute or relative path to the JSON or JSONC file to modify"),
    pointer: z.string().optional().describe("JSON Pointer path such as /scripts/build or /references/0/path."),
    action: z.enum(["set", "delete", "merge", "append", "prepend", "insert", "replace", "create"]),
    value: z.unknown().optional(),
    index: z.coerce.number().int().min(0).optional(),
    create: z.boolean().optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    const parsed = dataEditParameters.safeParse(input)
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: issue.path,
          message: issue.message,
        })
      }
    }
  })

const frontmatterModeParameters = z
  .object({
    mode: z.literal("frontmatter"),
    filePath: z.string().describe("The absolute or relative path to the Markdown file to modify"),
    pointer: z.string().optional().describe("JSON Pointer path within the frontmatter, such as /title or /owner/team."),
    action: z.enum(["set", "delete", "merge", "append", "prepend", "insert", "replace", "create"]),
    value: z.unknown().optional(),
    index: z.coerce.number().int().min(0).optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    const parsed = frontmatterEditParameters.safeParse(input)
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: issue.path,
          message: issue.message,
        })
      }
    }
  })

const markdownModeParameters = z
  .object({
    mode: z.literal("markdown"),
    filePath: z.string().describe("The absolute or relative path to the Markdown file to modify"),
    heading: z.string(),
    content: z.string().optional(),
    action: z.enum(["replace", "append", "prepend", "delete", "create"]).optional(),
    create: z.boolean().optional(),
    position: z.enum(["end", "start", "before", "after"]).optional(),
    anchor: z.string().optional(),
    level: z.coerce.number().int().min(1).max(6).optional(),
    occurrence: z.coerce.number().int().min(1).optional(),
    anchor_occurrence: z.coerce.number().int().min(1).optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    const parsed = markdownEditParameters.safeParse(input)
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: issue.path,
          message: issue.message,
        })
      }
    }
  })

function obj(input: unknown) {
  return typeof input === "object" && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : undefined
}

function pick(input: Record<string, unknown>, keys: readonly string[]) {
  return Object.fromEntries(keys.flatMap((key) => (key in input ? [[key, input[key]]] : [])))
}

function canon(input: unknown) {
  const out = obj(input)
  if (!out) return input
  if (out.mode === "data") return pick(out, ["mode", "filePath", "pointer", "action", "value", "index", "create"])
  if (out.mode === "frontmatter") return pick(out, ["mode", "filePath", "pointer", "action", "value", "index"])
  if (out.mode === "markdown")
    return pick(out, [
      "mode",
      "filePath",
      "heading",
      "content",
      "action",
      "create",
      "position",
      "anchor",
      "level",
      "occurrence",
      "anchor_occurrence",
    ])
  if ("mode" in out && out.mode !== undefined && out.mode !== "") return input
  if ("edits" in out) return pick(out, ["filePath", "replaceAll", "edits"])
  return pick(out, ["filePath", "oldString", "newString", "replaceAll"])
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

function parseEditBranch(input: unknown) {
  const normalized = canon(input)
  const next = obj(normalized)
  if (!next) return singleEditParameters.safeParse(normalized)
  if (next.mode === "data") return dataModeParameters.safeParse(normalized)
  if (next.mode === "frontmatter") return frontmatterModeParameters.safeParse(normalized)
  if (next.mode === "markdown") return markdownModeParameters.safeParse(normalized)
  if (Array.isArray(next.edits)) return batchEditParameters.safeParse(normalized)
  return singleEditParameters.safeParse(normalized)
}

const parameters = z
  .object({
    mode: z.enum(["data", "frontmatter", "markdown"]).optional().describe("Optional structured edit mode."),
    filePath: z.string().optional().describe("Target file path for all edit modes."),
    oldString: z.string().optional().describe("Text to replace in normal single-edit mode."),
    newString: z.string().optional().describe("Replacement text in normal single-edit mode."),
    replaceAll: z.boolean().optional().describe("Replace all occurrences in normal or batch text edit mode."),
    edits: z.array(batchItemParameters).min(1).optional().describe("Sequential single-file edits for batch mode."),
    pointer: z.string().optional().describe("Structured pointer for data or frontmatter edit modes."),
    action: z
      .enum(["set", "delete", "merge", "append", "prepend", "insert", "replace", "create"])
      .optional()
      .describe(
        "Structured edit action. For data/frontmatter use set, delete, merge, append, prepend, insert, replace, or create. For markdown use replace, append, prepend, delete, or create.",
      ),
    value: z.unknown().optional().describe("Structured value payload for data or frontmatter edit modes."),
    index: z.coerce.number().int().min(0).optional().describe("Structured insertion index where supported."),
    create: z.boolean().optional().describe("Optional structured create flag where supported."),
    heading: z.string().optional().describe("Markdown heading target for markdown mode."),
    content: z.string().optional().describe("Markdown content payload for markdown mode."),
    position: z.enum(["end", "start", "before", "after"]).optional().describe("Markdown insertion position."),
    anchor: z.string().optional().describe("Markdown anchor heading when position needs one."),
    level: z.coerce.number().int().min(1).max(6).optional().describe("Markdown heading level for create mode."),
    occurrence: z.coerce.number().int().min(1).optional().describe("Markdown heading occurrence selector."),
    anchor_occurrence: z.coerce.number().int().min(1).optional().describe("Markdown anchor occurrence selector."),
  })
  .strict()
  .superRefine((input, ctx) => {
    const parsed = parseEditBranch(input)
    if (!parsed.success) addIssues(ctx, parsed.error)
  })

type EditParameters = z.infer<typeof parameters>
type ParsedEditParameters =
  | z.infer<typeof singleEditParameters>
  | z.infer<typeof batchEditParameters>
  | z.infer<typeof dataModeParameters>
  | z.infer<typeof frontmatterModeParameters>
  | z.infer<typeof markdownModeParameters>

function parseEditInput(input: EditParameters): ParsedEditParameters {
  const normalized = canon(input)
  const next = obj(normalized)
  if (!next) return singleEditParameters.parse(normalized)
  if (next.mode === "data") return dataModeParameters.parse(normalized)
  if (next.mode === "frontmatter") return frontmatterModeParameters.parse(normalized)
  if (next.mode === "markdown") return markdownModeParameters.parse(normalized)
  if (Array.isArray(next.edits)) return batchEditParameters.parse(normalized)
  return singleEditParameters.parse(normalized)
}

export const EditTool = Tool.define<typeof parameters, EditResultMetadata>("edit", {
  description: DESCRIPTION,
  parameters,
  async execute(params, ctx) {
    const input = parseEditInput(params)

    if ("mode" in input) {
      if (input.mode === "data") {
        const result = await executeDataEdit(input, ctx)
        return {
          ...result,
          metadata: {
            ...result.metadata,
            mode: "data",
          },
        }
      }
      if (input.mode === "frontmatter") {
        const result = await executeFrontmatterEdit(input, ctx)
        return {
          ...result,
          metadata: {
            ...result.metadata,
            mode: "frontmatter",
          },
        }
      }
      const result = await executeMarkdownEdit(markdownEditParameters.parse(input), ctx)
      return {
        ...result,
        metadata: {
          ...result.metadata,
          mode: "markdown",
        },
      }
    }

    if ("edits" in input) {
      const filePath = path.isAbsolute(input.filePath)
        ? input.filePath
        : path.join(Instance.directory, input.filePath)
      await assertExternalDirectory(ctx, filePath)

      let rolledBack = false
      const base = await Filesystem.readText(filePath).catch(() => undefined)
      let last = base
      let mtime = Filesystem.stat(filePath)?.mtime?.getTime()
      let size = Filesystem.stat(filePath)?.size
      let done = false
      const existed = base !== undefined
      try {
        let output: Awaited<ReturnType<typeof applyEditDetailed>>["output"] | undefined
        const results: Array<Awaited<ReturnType<typeof applyEditDetailed>>["output"]["metadata"]> = []

        for (const edit of input.edits) {
          const result = await applyEditDetailed(
            {
              filePath: input.filePath,
              oldString: edit.oldString,
              newString: edit.newString,
              replaceAll: edit.replaceAll ?? input.replaceAll,
            },
            ctx,
          )
          done = true
          output = result.output
          last = result.contentNew
          const next = Filesystem.stat(filePath)
          mtime = next?.mtime?.getTime()
          size = next?.size
          results.push(result.output.metadata)
        }

        const aggregate = await FileTime.withLock(filePath, async () => {
          await FileTime.assert(ctx.sessionID, filePath)
          const current = await Filesystem.readText(filePath)
          const diff = trimDiff(
            createTwoFilesPatch(filePath, filePath, normalizeLineEndings(base ?? ""), normalizeLineEndings(current)),
          )
          return {
            diff,
            filediff: buildFileDiff(filePath, base ?? "", current, diff),
          }
        })
        return {
          ...output!,
          metadata: {
            ...output!.metadata,
            diff: aggregate.diff,
            filediff: aggregate.filediff,
            results,
          },
        }
      } catch (error) {
        let rollbackSkipped = false
        const rollbackDiff = trimDiff(
          createTwoFilesPatch(filePath, filePath, normalizeLineEndings(base ?? ""), normalizeLineEndings(base ?? "")),
        )
        if (done) {
          await FileTime.withLock(filePath, async () => {
            const next = Filesystem.stat(filePath)
            const now = next ? await Filesystem.readText(filePath) : undefined
            const same = now === last && next?.mtime?.getTime() === mtime && next?.size === size

            if (!same) {
              rollbackSkipped = true
              return
            }

            if (existed) {
              await Filesystem.write(filePath, base ?? "")
            } else if (next) {
              await rm(filePath, { force: true })
            }
            rolledBack = true
            Bus.publish(File.Event.Edited, { file: filePath })
            await Bus.publish(FileWatcher.Event.Updated, {
              file: filePath,
              event: existed ? "change" : "unlink",
            })
            await FileTime.read(ctx.sessionID, filePath)
          })

          ctx.metadata({
            title: path.relative(Instance.worktree, filePath),
            metadata: {
              diff: rollbackDiff,
              filediff: {
                file: filePath,
                patch: rollbackDiff,
                additions: 0,
                deletions: 0,
              },
              results: [],
              rollback: rolledBack,
              rollbackSkipped,
            },
          })
          if (rolledBack) {
            if (existed) {
              await withTouchedFiles([filePath], async () => undefined)
            } else {
              await LSP.closeFile(filePath)
            }
          }
        }
        throw error
      }
    }

    const result = await applyEditDetailed(
      {
        filePath: input.filePath,
        oldString: input.oldString,
        newString: input.newString,
        replaceAll: input.replaceAll,
      },
      ctx,
    )
    return result.output
  },
})

async function applyEditDetailed(
  params: {
    filePath: string
    oldString: string
    newString: string
    replaceAll?: boolean
  },
  ctx: Tool.Context,
) {
  if (!params.filePath) {
    throw new Error("filePath is required")
  }

  if (params.oldString === params.newString) {
    throw new Error("No changes to apply: oldString and newString are identical.")
  }

  const filePath = path.isAbsolute(params.filePath) ? params.filePath : path.join(Instance.directory, params.filePath)
  await assertExternalDirectory(ctx, filePath)

  const semantic = await tryRenamePlan({
    file: filePath,
    old: params.oldString,
    next: params.newString,
    replaceAll: params.replaceAll,
    sessionID: ctx.sessionID,
  })
  if (semantic) return applyRenamePlan({ plan: semantic, ctx, file: filePath })

  const preview = await prepareEditState(filePath, params, ctx.sessionID)

  await ctx.ask({
    permission: "edit",
    patterns: [path.relative(Instance.worktree, filePath)],
    always: ["*"],
    metadata: {
      filepath: filePath,
      diff: preview.diff,
    },
  })

  const applied = await FileTime.withLock(filePath, async () => {
    const next = await prepareEditState(filePath, params, ctx.sessionID)
    let wrote = false
    let mtime: number | undefined
    let size: number | bigint | undefined
    try {
      await Filesystem.write(filePath, next.contentNew)
      wrote = true
      const stat = Filesystem.stat(filePath)
      mtime = stat?.mtime?.getTime()
      size = stat?.size
      await Format.file(filePath)
      Bus.publish(File.Event.Edited, { file: filePath })
      await Bus.publish(FileWatcher.Event.Updated, {
        file: filePath,
        event: next.existed ? "change" : "add",
      })
      const finalContent = await Filesystem.readText(filePath)
      await FileTime.read(ctx.sessionID, filePath)
      return {
        ...next,
        contentNew: finalContent,
        diff: trimDiff(
          createTwoFilesPatch(
            filePath,
            filePath,
            normalizeLineEndings(next.contentOld),
            normalizeLineEndings(finalContent),
          ),
        ),
      }
    } catch (error) {
      if (wrote) {
        const stat = Filesystem.stat(filePath)
        const now = stat ? await Filesystem.readText(filePath) : undefined
        const same = now === next.contentNew && stat?.mtime?.getTime() === mtime && stat?.size === size

        if (same) {
          if (next.existed) {
            await Filesystem.write(filePath, next.contentOld)
            await FileTime.read(ctx.sessionID, filePath)
          } else if (stat) {
            await rm(filePath, { force: true })
          }
        }
      }
      throw error
    }
  })

  const filediff: Snapshot.FileDiff = {
    file: filePath,
    patch: applied.diff,
    additions: diffLines(applied.contentOld, applied.contentNew).reduce(
      (total, change) => total + (change.added ? change.count || 0 : 0),
      0,
    ),
    deletions: diffLines(applied.contentOld, applied.contentNew).reduce(
      (total, change) => total + (change.removed ? change.count || 0 : 0),
      0,
    ),
  }

  let output = "Edit applied successfully."
  let touches: LSP.TouchStatus[] = []
  const diagnostics: Record<string, LSPClient.Diagnostic[]> = {}
  await withTouchedFiles([filePath], async (next) => {
    touches = next
    const result = await LSP.diagnostics()
    Object.assign(diagnostics, result)
    output = appendTouchWarnings(output, touches)
    output = appendDiagnostics(output, result, [filePath])
    output = await appendCodeActions(output, result, [filePath])
  })

  ctx.metadata({
    metadata: {
      diff: applied.diff,
      filediff,
      diagnostics,
      lsp: {
        touches,
      },
    },
  })

  return {
    filePath,
    contentOld: applied.contentOld,
    contentNew: applied.contentNew,
    output: {
      metadata: {
        diagnostics,
        lsp: {
          touches,
        },
        diff: applied.diff,
        filediff,
      },
      title: `${path.relative(Instance.worktree, filePath)}`,
      output,
    },
  }
}

async function prepareEditState(
  filePath: string,
  params: {
    oldString: string
    newString: string
    replaceAll?: boolean
  },
  sessionID: Tool.Context["sessionID"],
) {
  if (params.oldString === "") {
    const existed = await Filesystem.exists(filePath)
    const contentOld = existed ? await Filesystem.readText(filePath) : ""
    return {
      existed,
      contentOld,
      contentNew: params.newString,
      diff: trimDiff(
        createTwoFilesPatch(
          filePath,
          filePath,
          normalizeLineEndings(contentOld),
          normalizeLineEndings(params.newString),
        ),
      ),
    }
  }

  const stats = Filesystem.stat(filePath)
  if (!stats) throw new Error(`File ${filePath} not found`)
  if (stats.isDirectory()) throw new Error(`Path is a directory, not a file: ${filePath}`)
  await FileTime.assert(sessionID, filePath)
  const contentOld = await Filesystem.readText(filePath)
  const ending = detectLineEnding(contentOld)
  const old = convertToLineEnding(normalizeLineEndings(params.oldString), ending)
  const next = convertToLineEnding(normalizeLineEndings(params.newString), ending)
  const contentNew = replace(contentOld, old, next, params.replaceAll)
  return {
    existed: true,
    contentOld,
    contentNew,
    diff: trimDiff(
      createTwoFilesPatch(filePath, filePath, normalizeLineEndings(contentOld), normalizeLineEndings(contentNew)),
    ),
  }
}

function prepareEditFromContent(
  filePath: string,
  contentOld: string,
  params: {
    oldString: string
    newString: string
    replaceAll?: boolean
  },
) {
  if (params.oldString === params.newString) {
    throw new Error("No changes to apply: oldString and newString are identical.")
  }

  if (params.oldString === "") {
    const contentNew = params.newString
    return {
      contentOld,
      contentNew,
      diff: trimDiff(
        createTwoFilesPatch(filePath, filePath, normalizeLineEndings(contentOld), normalizeLineEndings(contentNew)),
      ),
    }
  }

  const ending = detectLineEnding(contentOld)
  const old = convertToLineEnding(normalizeLineEndings(params.oldString), ending)
  const next = convertToLineEnding(normalizeLineEndings(params.newString), ending)
  const contentNew = replace(contentOld, old, next, params.replaceAll)
  return {
    contentOld,
    contentNew,
    diff: trimDiff(
      createTwoFilesPatch(filePath, filePath, normalizeLineEndings(contentOld), normalizeLineEndings(contentNew)),
    ),
  }
}

function buildFileDiff(filePath: string, contentOld: string, contentNew: string, diff: string): Snapshot.FileDiff {
  return {
    file: filePath,
    patch: diff,
    additions: diffLines(contentOld, contentNew).reduce(
      (total, change) => total + (change.added ? change.count || 0 : 0),
      0,
    ),
    deletions: diffLines(contentOld, contentNew).reduce(
      (total, change) => total + (change.removed ? change.count || 0 : 0),
      0,
    ),
  }
}

export type Replacer = (content: string, find: string) => Generator<string, void, unknown>

// Similarity thresholds for block anchor fallback matching
const SINGLE_CANDIDATE_SIMILARITY_THRESHOLD = 0.0
const MULTIPLE_CANDIDATES_SIMILARITY_THRESHOLD = 0.3

/**
 * Levenshtein distance algorithm implementation
 */
function levenshtein(a: string, b: string): number {
  // Handle empty strings
  if (a === "" || b === "") {
    return Math.max(a.length, b.length)
  }
  const matrix = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  )

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost)
    }
  }
  return matrix[a.length][b.length]
}

export const SimpleReplacer: Replacer = function* (_content, find) {
  yield find
}

export const LineTrimmedReplacer: Replacer = function* (content, find) {
  const originalLines = content.split("\n")
  const searchLines = find.split("\n")

  if (searchLines[searchLines.length - 1] === "") {
    searchLines.pop()
  }

  for (let i = 0; i <= originalLines.length - searchLines.length; i++) {
    let matches = true

    for (let j = 0; j < searchLines.length; j++) {
      const originalTrimmed = originalLines[i + j].trim()
      const searchTrimmed = searchLines[j].trim()

      if (originalTrimmed !== searchTrimmed) {
        matches = false
        break
      }
    }

    if (matches) {
      let matchStartIndex = 0
      for (let k = 0; k < i; k++) {
        matchStartIndex += originalLines[k].length + 1
      }

      let matchEndIndex = matchStartIndex
      for (let k = 0; k < searchLines.length; k++) {
        matchEndIndex += originalLines[i + k].length
        if (k < searchLines.length - 1) {
          matchEndIndex += 1 // Add newline character except for the last line
        }
      }

      yield content.substring(matchStartIndex, matchEndIndex)
    }
  }
}

export const BlockAnchorReplacer: Replacer = function* (content, find) {
  const originalLines = content.split("\n")
  const searchLines = find.split("\n")

  if (searchLines.length < 3) {
    return
  }

  if (searchLines[searchLines.length - 1] === "") {
    searchLines.pop()
  }

  const firstLineSearch = searchLines[0].trim()
  const lastLineSearch = searchLines[searchLines.length - 1].trim()
  const searchBlockSize = searchLines.length

  // Collect all candidate positions where both anchors match
  const candidates: Array<{ startLine: number; endLine: number }> = []
  for (let i = 0; i < originalLines.length; i++) {
    if (originalLines[i].trim() !== firstLineSearch) {
      continue
    }

    // Look for the matching last line after this first line
    for (let j = i + 2; j < originalLines.length; j++) {
      if (originalLines[j].trim() === lastLineSearch) {
        candidates.push({ startLine: i, endLine: j })
        break // Only match the first occurrence of the last line
      }
    }
  }

  // Return immediately if no candidates
  if (candidates.length === 0) {
    return
  }

  // Handle single candidate scenario (using relaxed threshold)
  if (candidates.length === 1) {
    const { startLine, endLine } = candidates[0]
    const actualBlockSize = endLine - startLine + 1

    let similarity = 0
    let linesToCheck = Math.min(searchBlockSize - 2, actualBlockSize - 2) // Middle lines only

    if (linesToCheck > 0) {
      for (let j = 1; j < searchBlockSize - 1 && j < actualBlockSize - 1; j++) {
        const originalLine = originalLines[startLine + j].trim()
        const searchLine = searchLines[j].trim()
        const maxLen = Math.max(originalLine.length, searchLine.length)
        if (maxLen === 0) {
          continue
        }
        const distance = levenshtein(originalLine, searchLine)
        similarity += (1 - distance / maxLen) / linesToCheck

        // Exit early when threshold is reached
        if (similarity >= SINGLE_CANDIDATE_SIMILARITY_THRESHOLD) {
          break
        }
      }
    } else {
      // No middle lines to compare, just accept based on anchors
      similarity = 1.0
    }

    if (similarity >= SINGLE_CANDIDATE_SIMILARITY_THRESHOLD) {
      let matchStartIndex = 0
      for (let k = 0; k < startLine; k++) {
        matchStartIndex += originalLines[k].length + 1
      }
      let matchEndIndex = matchStartIndex
      for (let k = startLine; k <= endLine; k++) {
        matchEndIndex += originalLines[k].length
        if (k < endLine) {
          matchEndIndex += 1 // Add newline character except for the last line
        }
      }
      yield content.substring(matchStartIndex, matchEndIndex)
    }
    return
  }

  // Calculate similarity for multiple candidates
  let bestMatch: { startLine: number; endLine: number } | null = null
  let maxSimilarity = -1

  for (const candidate of candidates) {
    const { startLine, endLine } = candidate
    const actualBlockSize = endLine - startLine + 1

    let similarity = 0
    let linesToCheck = Math.min(searchBlockSize - 2, actualBlockSize - 2) // Middle lines only

    if (linesToCheck > 0) {
      for (let j = 1; j < searchBlockSize - 1 && j < actualBlockSize - 1; j++) {
        const originalLine = originalLines[startLine + j].trim()
        const searchLine = searchLines[j].trim()
        const maxLen = Math.max(originalLine.length, searchLine.length)
        if (maxLen === 0) {
          continue
        }
        const distance = levenshtein(originalLine, searchLine)
        similarity += 1 - distance / maxLen
      }
      similarity /= linesToCheck // Average similarity
    } else {
      // No middle lines to compare, just accept based on anchors
      similarity = 1.0
    }

    if (similarity > maxSimilarity) {
      maxSimilarity = similarity
      bestMatch = candidate
    }
  }

  // Threshold judgment
  if (maxSimilarity >= MULTIPLE_CANDIDATES_SIMILARITY_THRESHOLD && bestMatch) {
    const { startLine, endLine } = bestMatch
    let matchStartIndex = 0
    for (let k = 0; k < startLine; k++) {
      matchStartIndex += originalLines[k].length + 1
    }
    let matchEndIndex = matchStartIndex
    for (let k = startLine; k <= endLine; k++) {
      matchEndIndex += originalLines[k].length
      if (k < endLine) {
        matchEndIndex += 1
      }
    }
    yield content.substring(matchStartIndex, matchEndIndex)
  }
}

export const WhitespaceNormalizedReplacer: Replacer = function* (content, find) {
  const normalizeWhitespace = (text: string) => text.replace(/\s+/g, " ").trim()
  const normalizedFind = normalizeWhitespace(find)

  // Handle single line matches
  const lines = content.split("\n")
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (normalizeWhitespace(line) === normalizedFind) {
      yield line
    } else {
      // Only check for substring matches if the full line doesn't match
      const normalizedLine = normalizeWhitespace(line)
      if (normalizedLine.includes(normalizedFind)) {
        // Find the actual substring in the original line that matches
        const words = find.trim().split(/\s+/)
        if (words.length > 0) {
          const pattern = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+")
          try {
            const regex = new RegExp(pattern)
            const match = line.match(regex)
            if (match) {
              yield match[0]
            }
          } catch (e) {
            // Invalid regex pattern, skip
          }
        }
      }
    }
  }

  // Handle multi-line matches
  const findLines = find.split("\n")
  if (findLines.length > 1) {
    for (let i = 0; i <= lines.length - findLines.length; i++) {
      const block = lines.slice(i, i + findLines.length)
      if (normalizeWhitespace(block.join("\n")) === normalizedFind) {
        yield block.join("\n")
      }
    }
  }
}

export const IndentationFlexibleReplacer: Replacer = function* (content, find) {
  const removeIndentation = (text: string) => {
    const lines = text.split("\n")
    const nonEmptyLines = lines.filter((line) => line.trim().length > 0)
    if (nonEmptyLines.length === 0) return text

    const minIndent = Math.min(
      ...nonEmptyLines.map((line) => {
        const match = line.match(/^(\s*)/)
        return match ? match[1].length : 0
      }),
    )

    return lines.map((line) => (line.trim().length === 0 ? line : line.slice(minIndent))).join("\n")
  }

  const normalizedFind = removeIndentation(find)
  const contentLines = content.split("\n")
  const findLines = find.split("\n")

  for (let i = 0; i <= contentLines.length - findLines.length; i++) {
    const block = contentLines.slice(i, i + findLines.length).join("\n")
    if (removeIndentation(block) === normalizedFind) {
      yield block
    }
  }
}

export const EscapeNormalizedReplacer: Replacer = function* (content, find) {
  const unescapeString = (str: string): string => {
    return str.replace(/\\(n|t|r|'|"|`|\\|\n|\$)/g, (match, capturedChar) => {
      switch (capturedChar) {
        case "n":
          return "\n"
        case "t":
          return "\t"
        case "r":
          return "\r"
        case "'":
          return "'"
        case '"':
          return '"'
        case "`":
          return "`"
        case "\\":
          return "\\"
        case "\n":
          return "\n"
        case "$":
          return "$"
        default:
          return match
      }
    })
  }

  const unescapedFind = unescapeString(find)

  // Try direct match with unescaped find string
  if (content.includes(unescapedFind)) {
    yield unescapedFind
  }

  // Also try finding escaped versions in content that match unescaped find
  const lines = content.split("\n")
  const findLines = unescapedFind.split("\n")

  for (let i = 0; i <= lines.length - findLines.length; i++) {
    const block = lines.slice(i, i + findLines.length).join("\n")
    const unescapedBlock = unescapeString(block)

    if (unescapedBlock === unescapedFind) {
      yield block
    }
  }
}

export const MultiOccurrenceReplacer: Replacer = function* (content, find) {
  // This replacer yields all exact matches, allowing the replace function
  // to handle multiple occurrences based on replaceAll parameter
  let startIndex = 0

  while (true) {
    const index = content.indexOf(find, startIndex)
    if (index === -1) break

    yield find
    startIndex = index + find.length
  }
}

export const TrimmedBoundaryReplacer: Replacer = function* (content, find) {
  const trimmedFind = find.trim()

  if (trimmedFind === find) {
    // Already trimmed, no point in trying
    return
  }

  // Try to find the trimmed version
  if (content.includes(trimmedFind)) {
    yield trimmedFind
  }

  // Also try finding blocks where trimmed content matches
  const lines = content.split("\n")
  const findLines = find.split("\n")

  for (let i = 0; i <= lines.length - findLines.length; i++) {
    const block = lines.slice(i, i + findLines.length).join("\n")

    if (block.trim() === trimmedFind) {
      yield block
    }
  }
}

export const ContextAwareReplacer: Replacer = function* (content, find) {
  const findLines = find.split("\n")
  if (findLines.length < 3) {
    // Need at least 3 lines to have meaningful context
    return
  }

  // Remove trailing empty line if present
  if (findLines[findLines.length - 1] === "") {
    findLines.pop()
  }

  const contentLines = content.split("\n")

  // Extract first and last lines as context anchors
  const firstLine = findLines[0].trim()
  const lastLine = findLines[findLines.length - 1].trim()

  // Find blocks that start and end with the context anchors
  for (let i = 0; i < contentLines.length; i++) {
    if (contentLines[i].trim() !== firstLine) continue

    // Look for the matching last line
    for (let j = i + 2; j < contentLines.length; j++) {
      if (contentLines[j].trim() === lastLine) {
        // Found a potential context block
        const blockLines = contentLines.slice(i, j + 1)
        const block = blockLines.join("\n")

        // Check if the middle content has reasonable similarity
        // (simple heuristic: at least 50% of non-empty lines should match when trimmed)
        if (blockLines.length === findLines.length) {
          let matchingLines = 0
          let totalNonEmptyLines = 0

          for (let k = 1; k < blockLines.length - 1; k++) {
            const blockLine = blockLines[k].trim()
            const findLine = findLines[k].trim()

            if (blockLine.length > 0 || findLine.length > 0) {
              totalNonEmptyLines++
              if (blockLine === findLine) {
                matchingLines++
              }
            }
          }

          if (totalNonEmptyLines === 0 || matchingLines / totalNonEmptyLines >= 0.5) {
            yield block
            break // Only match the first occurrence
          }
        }
        break
      }
    }
  }
}

export function trimDiff(diff: string): string {
  const lines = diff.split("\n")
  const contentLines = lines.filter(
    (line) =>
      (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ")) &&
      !line.startsWith("---") &&
      !line.startsWith("+++"),
  )

  if (contentLines.length === 0) return diff

  let min = Infinity
  for (const line of contentLines) {
    const content = line.slice(1)
    if (content.trim().length > 0) {
      const match = content.match(/^(\s*)/)
      if (match) min = Math.min(min, match[1].length)
    }
  }
  if (min === Infinity || min === 0) return diff
  const trimmedLines = lines.map((line) => {
    if (
      (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ")) &&
      !line.startsWith("---") &&
      !line.startsWith("+++")
    ) {
      const prefix = line[0]
      const content = line.slice(1)
      return prefix + content.slice(min)
    }
    return line
  })

  return trimmedLines.join("\n")
}

export function replace(content: string, oldString: string, newString: string, replaceAll = false): string {
  if (oldString === newString) {
    throw new Error("No changes to apply: oldString and newString are identical.")
  }

  let notFound = true

  for (const replacer of [
    SimpleReplacer,
    LineTrimmedReplacer,
    BlockAnchorReplacer,
    WhitespaceNormalizedReplacer,
    IndentationFlexibleReplacer,
    EscapeNormalizedReplacer,
    TrimmedBoundaryReplacer,
    ContextAwareReplacer,
    MultiOccurrenceReplacer,
  ]) {
    for (const search of replacer(content, oldString)) {
      const index = content.indexOf(search)
      if (index === -1) continue
      notFound = false
      if (replaceAll) {
        return content.replaceAll(search, newString)
      }
      const lastIndex = content.lastIndexOf(search)
      if (index !== lastIndex) continue
      return content.substring(0, index) + newString + content.substring(index + search.length)
    }
  }

  if (notFound) {
    throw new Error(
      "Could not find oldString in the file. It must match exactly, including whitespace, indentation, and line endings.",
    )
  }
  throw new Error("Found multiple matches for oldString. Provide more surrounding context to make the match unique.")
}
