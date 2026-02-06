import z from "zod"
import * as path from "path"
import * as fs from "node:fs/promises"
import { Tool } from "./tool"
import { LSP } from "../lsp"
import { createTwoFilesPatch } from "diff"
import DESCRIPTION from "./write.txt"
import { Bus } from "../bus"
import { File } from "../file"
import { FileWatcher } from "../file/watcher"
import { FileTime } from "../file/time"
import { Filesystem } from "../util/filesystem"
import { Instance } from "../project/instance"
import { trimDiff } from "./edit"
import { assertExternalDirectory } from "./external-directory"

const MAX_DIAGNOSTICS_PER_FILE = 20
const MAX_PROJECT_DIAGNOSTICS_FILES = 5

function normalizeLineEndings(text: string): string {
  return text.replaceAll("\r\n", "\n")
}

export const WriteTool = Tool.define("write", {
  description: DESCRIPTION,
  parameters: z.object({
    content: z.string().describe("The content to write to the file"),
    filePath: z.string().describe("The absolute path to the file to write (must be absolute, not relative)"),
  }),
  async execute(params, ctx) {
    const filepath = path.isAbsolute(params.filePath) ? params.filePath : path.join(Instance.directory, params.filePath)
    await assertExternalDirectory(ctx, filepath)

    return await FileTime.withLock(filepath, async () => {
      const file = Bun.file(filepath)
      const exists = await file.exists()
      const contentOld = exists ? await file.text() : ""
      if (exists) await FileTime.assert(ctx.sessionID, filepath)

      const diff = trimDiff(createTwoFilesPatch(filepath, filepath, contentOld, params.content))
      await ctx.ask({
        permission: "edit",
        patterns: [path.relative(Instance.worktree, filepath)],
        always: ["*"],
        metadata: {
          filepath,
          diff,
        },
      })

      // Atomic write using temp file and rename
      const tempPath = `${filepath}.tmp.${Math.random().toString(36).slice(2)}`
      try {
        await Bun.write(tempPath, params.content)
        await fs.rename(tempPath, filepath)
      } catch (e) {
        // Clean up temp file if rename fails
        if (await Bun.file(tempPath).exists()) {
          await fs.unlink(tempPath).catch(() => {})
        }
        throw e
      }

      // Post-write verification
      const writtenContent = await Bun.file(filepath).text()
      if (writtenContent !== params.content) {
        throw new Error("Verification failed: written content does not match expected content")
      }

      await Bus.publish(File.Event.Edited, {
        file: filepath,
      })
      await Bus.publish(FileWatcher.Event.Updated, {
        file: filepath,
        event: exists ? "change" : "add",
      })
      FileTime.read(ctx.sessionID, filepath)

      let output = "Wrote file successfully."
      await LSP.touchFile(filepath, true)
      const diagnostics = await LSP.diagnostics()
      const normalizedFilepath = Filesystem.normalizePath(filepath)
      let projectDiagnosticsCount = 0
      for (const [file, issues] of Object.entries(diagnostics)) {
        const errors = issues.filter((item) => item.severity === 1)
        if (errors.length === 0) continue
        const limited = errors.slice(0, MAX_DIAGNOSTICS_PER_FILE)
        const suffix =
          errors.length > MAX_DIAGNOSTICS_PER_FILE ? `\n... and ${errors.length - MAX_DIAGNOSTICS_PER_FILE} more` : ""
        if (file === normalizedFilepath) {
          output += `\n\nLSP errors detected in this file, please fix:\n<diagnostics file="${filepath}">\n${limited.map(LSP.Diagnostic.pretty).join("\n")}${suffix}\n</diagnostics>`
          continue
        }
        if (projectDiagnosticsCount >= MAX_PROJECT_DIAGNOSTICS_FILES) continue
        projectDiagnosticsCount++
        output += `\n\nLSP errors detected in other files:\n<diagnostics file="${file}">\n${limited.map(LSP.Diagnostic.pretty).join("\n")}${suffix}\n</diagnostics>`
      }

      return {
        title: path.relative(Instance.worktree, filepath),
        metadata: {
          diagnostics,
          filepath,
          exists: exists,
        },
        output,
      }
    })
  },
})
