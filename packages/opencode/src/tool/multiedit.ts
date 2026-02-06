import z from "zod"
import { Tool } from "./tool"
import { replace, trimDiff, normalizeLineEndings } from "./edit"
import DESCRIPTION from "./multiedit.txt"
import path from "path"
import { Instance } from "../project/instance"
import { FileTime } from "../file/time"
import { assertExternalDirectory } from "./external-directory"
import { createTwoFilesPatch, diffLines } from "diff"
import { Bus } from "../bus"
import { File } from "../file"
import { FileWatcher } from "../file/watcher"
import { Snapshot } from "@/snapshot"
import { LSP } from "../lsp"
import { Filesystem } from "../util/filesystem"

const MAX_DIAGNOSTICS_PER_FILE = 20

export const MultiEditTool = Tool.define("multiedit", {
  description: DESCRIPTION,
  parameters: z.object({
    filePath: z.string().describe("The absolute path to the file to modify"),
    edits: z
      .array(
        z.object({
          oldString: z.string().describe("The text to replace"),
          newString: z.string().describe("The text to replace it with (must be different from oldString)"),
          replaceAll: z.boolean().optional().describe("Replace all occurrences of oldString (default false)"),
          matchStrategy: z
            .enum([
              "simple",
              "multi-occurrence",
              "line-trimmed",
              "block-anchor",
              "whitespace-normalized",
              "indentation-flexible",
              "escape-normalized",
              "trimmed-boundary",
              "context-aware",
              "regex",
            ])
            .optional()
            .describe("The strategy to use for matching oldString"),
          contextLines: z.number().optional().describe("Number of context lines to use for matching (default 3)"),
          regexFlags: z.string().optional().describe("Regex flags to use if matchStrategy is 'regex' (e.g., 'gi')"),
          anchorLines: z
            .object({
              start: z.number().optional().describe("Start line number to restrict the search"),
              end: z.number().optional().describe("End line number to restrict the search"),
            })
            .optional()
            .describe("Restrict the search to a specific line range"),
        }),
      )
      .describe("Array of edit operations to perform sequentially on the file"),
    dryRun: z.boolean().optional().describe("If true, only return the diff without applying changes"),
  }),
  async execute(params, ctx) {
    if (!params.filePath) {
      throw new Error("filePath is required")
    }

    const filePath = path.isAbsolute(params.filePath) ? params.filePath : path.join(Instance.directory, params.filePath)
    await assertExternalDirectory(ctx, filePath)

    let contentOld = ""
    let contentNew = ""
    let diff = ""

    await FileTime.withLock(filePath, async () => {
      const file = Bun.file(filePath)
      const stats = await file.stat().catch(() => {})
      if (!stats) throw new Error(`File ${filePath} not found`)
      if (stats.isDirectory()) throw new Error(`Path is a directory, not a file: ${filePath}`)

      await FileTime.assert(ctx.sessionID, filePath)
      contentOld = await file.text()
      contentNew = contentOld

      const editInfos: any[] = []
      for (const edit of params.edits) {
        if (edit.oldString === edit.newString) {
          throw new Error("oldString and newString must be different")
        }
        try {
          const result = replace(contentNew, edit.oldString, edit.newString, {
            replaceAll: edit.replaceAll,
            matchStrategy: edit.matchStrategy,
            regexFlags: edit.regexFlags,
            anchorLines: edit.anchorLines,
            contextLines: edit.contextLines,
          })
          contentNew = result.content
          editInfos.push(result)
        } catch (e: any) {
          if (e.metadata) {
            ctx.metadata({ metadata: e.metadata })
          }
          throw e
        }
      }

      diff = trimDiff(
        createTwoFilesPatch(filePath, filePath, normalizeLineEndings(contentOld), normalizeLineEndings(contentNew)),
      )

      if (params.dryRun) {
        return {
          metadata: {
            diff,
            editInfos,
          },
          output: `Dry run successful. Changes previewed in diff.`,
        }
      }

      await ctx.ask({
        permission: "edit",
        patterns: [path.relative(Instance.worktree, filePath)],
        always: ["*"],
        metadata: {
          filepath: filePath,
          diff,
        },
      })

      await file.write(contentNew)
      await Bus.publish(File.Event.Edited, {
        file: filePath,
      })
      await Bus.publish(FileWatcher.Event.Updated, {
        file: filePath,
        event: "change",
      })
      FileTime.read(ctx.sessionID, filePath)
    })

    const filediff: Snapshot.FileDiff = {
      file: filePath,
      before: contentOld,
      after: contentNew,
      additions: 0,
      deletions: 0,
    }

    for (const change of diffLines(contentOld, contentNew)) {
      if (change.added) filediff.additions += change.count ?? 0
      if (change.removed) filediff.deletions += change.count ?? 0
    }

    ctx.metadata({
      metadata: {
        diff,
        filediff,
        diagnostics: {},
      },
    })

    let output = "Edits applied successfully."
    await LSP.touchFile(filePath, true)
    const diagnostics = await LSP.diagnostics()
    const normalizedFilePath = Filesystem.normalizePath(filePath)
    const issues = diagnostics[normalizedFilePath] ?? []
    const errors = issues.filter((item) => item.severity === 1)
    if (errors.length > 0) {
      const limited = errors.slice(0, MAX_DIAGNOSTICS_PER_FILE)
      const suffix =
        errors.length > MAX_DIAGNOSTICS_PER_FILE ? `\n... and ${errors.length - MAX_DIAGNOSTICS_PER_FILE} more` : ""
      output += `\n\nLSP errors detected in this file, please fix:\n<diagnostics file="${filePath}">\n${limited.map(LSP.Diagnostic.pretty).join("\n")}${suffix}\n</diagnostics>`
    }

    return {
      metadata: {
        diagnostics,
        diff,
        filediff,
      },
      title: `${path.relative(Instance.worktree, filePath)}`,
      output,
    }
  },
})
