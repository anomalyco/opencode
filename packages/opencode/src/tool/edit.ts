import z from "zod"
import * as path from "path"
import * as fs from "fs/promises"
import { createTwoFilesPatch, diffLines } from "diff"
import { Tool } from "./tool"
import { LSP } from "../lsp"
import DESCRIPTION from "./edit.txt"
import { File } from "../file"
import { FileWatcher } from "../file/watcher"
import { Bus } from "../bus"
import { FileTime } from "../file/time"
import { Filesystem } from "../util/filesystem"
import { Instance } from "../project/instance"
import { Snapshot } from "@/snapshot"
import { assertExternalDirectory } from "./external-directory"
import {
  HashlineEdit,
  applyHashlineEdits,
  hashlineOnlyCreates,
  parseHashlineContent,
  serializeHashlineContent,
} from "./hashline"
import { Config } from "../config/config"

const MAX_DIAGNOSTICS_PER_FILE = 20
const HASHLINE_EDIT_MODE = "hashline"
const LEGACY_KEYS = ["oldString", "newString", "replaceAll"] as const

const EditParams = z
  .object({
    filePath: z.string().describe("The absolute path to the file to modify"),
    edits: z.array(HashlineEdit).optional(),
    delete: z.boolean().optional(),
    rename: z.string().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.edits !== undefined) return
    ctx.addIssue({
      code: "custom",
      message: "Hashline payload requires edits (use [] when only delete or rename is intended).",
    })
  })

type EditParams = z.infer<typeof EditParams>

function formatValidationError(error: z.ZodError) {
  const legacy = error.issues.some((issue) => {
    if (issue.code !== "unrecognized_keys") return false
    if (!("keys" in issue) || !Array.isArray(issue.keys)) return false
    return issue.keys.some((key) => LEGACY_KEYS.includes(key as (typeof LEGACY_KEYS)[number]))
  })
  if (legacy) {
    return "Legacy edit payload has been removed. Use hashline fields: { filePath, edits, delete?, rename? }."
  }
  return `Invalid parameters for tool 'edit':\n${error.issues.map((issue) => `- ${issue.message}`).join("\n")}`
}

function normalizeLineEndings(text: string): string {
  return text.replaceAll("\r\n", "\n")
}

async function withLocks(paths: string[], fn: () => Promise<void>) {
  const unique = Array.from(new Set(paths)).sort((a, b) => a.localeCompare(b))
  const recurse = async (idx: number): Promise<void> => {
    if (idx >= unique.length) return fn()
    await FileTime.withLock(unique[idx], () => recurse(idx + 1))
  }
  await recurse(0)
}

function createFileDiff(file: string, before: string, after: string): Snapshot.FileDiff {
  const filediff: Snapshot.FileDiff = {
    file,
    before,
    after,
    additions: 0,
    deletions: 0,
  }
  for (const change of diffLines(before, after)) {
    if (change.added) filediff.additions += change.count || 0
    if (change.removed) filediff.deletions += change.count || 0
  }
  return filediff
}

async function diagnosticsOutput(filePath: string, output: string) {
  await LSP.touchFile(filePath, true)
  const diagnostics = await LSP.diagnostics()
  const normalizedFilePath = Filesystem.normalizePath(filePath)
  const issues = diagnostics[normalizedFilePath] ?? []
  const errors = issues.filter((item) => item.severity === 1)
  if (errors.length === 0) {
    return {
      output,
      diagnostics,
    }
  }

  const limited = errors.slice(0, MAX_DIAGNOSTICS_PER_FILE)
  const suffix =
    errors.length > MAX_DIAGNOSTICS_PER_FILE ? `\n... and ${errors.length - MAX_DIAGNOSTICS_PER_FILE} more` : ""
  return {
    output:
      output +
      `\n\nLSP errors detected in this file, please fix:\n<diagnostics file="${filePath}">\n${limited.map(LSP.Diagnostic.pretty).join("\n")}${suffix}\n</diagnostics>`,
    diagnostics,
  }
}

async function executeHashline(
  params: EditParams,
  ctx: Tool.Context,
  autocorrect: boolean,
  aggressiveAutocorrect: boolean,
) {
  const sourcePath = path.isAbsolute(params.filePath) ? params.filePath : path.join(Instance.directory, params.filePath)
  const targetPath = params.rename
    ? path.isAbsolute(params.rename)
      ? params.rename
      : path.join(Instance.directory, params.rename)
    : sourcePath
  const edits = params.edits ?? []

  await assertExternalDirectory(ctx, sourcePath)
  if (params.rename) {
    await assertExternalDirectory(ctx, targetPath)
  }

  if (params.delete && edits.length > 0) {
    throw new Error("delete=true cannot be combined with edits")
  }
  if (params.delete && params.rename) {
    throw new Error("delete=true cannot be combined with rename")
  }

  let diff = ""
  let before = ""
  let after = ""
  let noop = 0
  let deleted = false
  let changed = false
  let diagnostics: Awaited<ReturnType<typeof LSP.diagnostics>> = {}
  await withLocks([sourcePath, targetPath], async () => {
    const sourceStat = Filesystem.stat(sourcePath)
    if (sourceStat?.isDirectory()) throw new Error(`Path is a directory, not a file: ${sourcePath}`)
    const exists = Boolean(sourceStat)

    if (params.rename && !exists) {
      throw new Error("rename requires an existing source file")
    }

    if (params.delete) {
      if (!exists) {
        noop = 1
        return
      }
      await FileTime.assert(ctx.sessionID, sourcePath)
      before = await Filesystem.readText(sourcePath)
      diff = trimDiff(createTwoFilesPatch(sourcePath, sourcePath, normalizeLineEndings(before), ""))
      await ctx.ask({
        permission: "edit",
        patterns: [path.relative(Instance.worktree, sourcePath)],
        always: ["*"],
        metadata: {
          filepath: sourcePath,
          diff,
        },
      })
      await fs.rm(sourcePath, { force: true })
      await Bus.publish(File.Event.Edited, {
        file: sourcePath,
      })
      await Bus.publish(FileWatcher.Event.Updated, {
        file: sourcePath,
        event: "unlink",
      })
      deleted = true
      changed = true
      return
    }

    if (!exists && !hashlineOnlyCreates(edits)) {
      throw new Error("Missing file can only be created with append/prepend hashline edits")
    }
    if (exists) {
      await FileTime.assert(ctx.sessionID, sourcePath)
    }

    const parsed = exists
      ? parseHashlineContent(await Filesystem.readBytes(sourcePath))
      : {
          bom: false,
          eol: "\n",
          trailing: false,
          lines: [] as string[],
          text: "",
          raw: "",
        }

    before = parsed.raw
    const next = applyHashlineEdits({
      lines: parsed.lines,
      trailing: parsed.trailing,
      edits,
      autocorrect,
      aggressiveAutocorrect,
    })
    const output = serializeHashlineContent({
      lines: next.lines,
      trailing: next.trailing,
      eol: parsed.eol,
      bom: parsed.bom,
    })
    after = output.text

    if (before === after && sourcePath === targetPath) {
      noop = 1
      diff = trimDiff(
        createTwoFilesPatch(sourcePath, sourcePath, normalizeLineEndings(before), normalizeLineEndings(after)),
      )
      return
    }

    diff = trimDiff(
      createTwoFilesPatch(sourcePath, targetPath, normalizeLineEndings(before), normalizeLineEndings(after)),
    )
    const patterns = [path.relative(Instance.worktree, sourcePath)]
    if (sourcePath !== targetPath) patterns.push(path.relative(Instance.worktree, targetPath))
    await ctx.ask({
      permission: "edit",
      patterns: Array.from(new Set(patterns)),
      always: ["*"],
      metadata: {
        filepath: sourcePath,
        diff,
      },
    })

    if (sourcePath === targetPath) {
      await Filesystem.write(sourcePath, output.bytes)
      await Bus.publish(File.Event.Edited, {
        file: sourcePath,
      })
      await Bus.publish(FileWatcher.Event.Updated, {
        file: sourcePath,
        event: exists ? "change" : "add",
      })
      FileTime.read(ctx.sessionID, sourcePath)
      changed = true
      return
    }

    const targetExists = await Filesystem.exists(targetPath)
    await Filesystem.write(targetPath, output.bytes)
    await fs.rm(sourcePath, { force: true })
    await Bus.publish(File.Event.Edited, {
      file: sourcePath,
    })
    await Bus.publish(File.Event.Edited, {
      file: targetPath,
    })
    await Bus.publish(FileWatcher.Event.Updated, {
      file: sourcePath,
      event: "unlink",
    })
    await Bus.publish(FileWatcher.Event.Updated, {
      file: targetPath,
      event: targetExists ? "change" : "add",
    })
    FileTime.read(ctx.sessionID, targetPath)
    changed = true
  })

  const file = deleted ? sourcePath : targetPath
  const filediff = createFileDiff(file, before, after)
  ctx.metadata({
    metadata: {
      diff,
      filediff,
      diagnostics,
      edit_mode: HASHLINE_EDIT_MODE,
      noop,
    },
  })

  if (!deleted && (changed || noop === 0)) {
    const result = await diagnosticsOutput(targetPath, noop > 0 ? "No changes applied." : "Edit applied successfully.")
    diagnostics = result.diagnostics
    return {
      metadata: {
        diagnostics,
        diff,
        filediff,
        edit_mode: HASHLINE_EDIT_MODE,
        noop,
      },
      title: `${path.relative(Instance.worktree, targetPath)}`,
      output: result.output,
    }
  }

  return {
    metadata: {
      diagnostics,
      diff,
      filediff,
      edit_mode: HASHLINE_EDIT_MODE,
      noop,
    },
    title: `${path.relative(Instance.worktree, file)}`,
    output: deleted ? "Edit applied successfully." : "No changes applied.",
  }
}

export const EditTool = Tool.define("edit", {
  description: DESCRIPTION,
  parameters: EditParams,
  formatValidationError,
  async execute(params, ctx) {
    if (!params.filePath) {
      throw new Error("filePath is required")
    }

    const config = await Config.get()
    return executeHashline(
      params,
      ctx,
      config.experimental?.hashline_autocorrect !== false || Bun.env.OPENCODE_HL_AUTOCORRECT === "1",
      Bun.env.OPENCODE_HL_AUTOCORRECT === "1",
    )
  },
})

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
