import z from "zod"
import { Tool } from "./tool"
import { Log } from "../util/log"
import { getInstrumentedFiles } from "./debug-instrument"
import fs from "fs/promises"
import path from "path"

const log = Log.create({ service: "debug-cleanup" })

const DESCRIPTION = `
Removes debug instrumentation from files that were previously instrumented with debug_instrument.

This tool restores files to their original state by:
1. Reverting to the original file contents saved before instrumentation
2. Clearing the instrumentation tracking

Use this tool after you're done debugging to clean up the added logging code.

If no files are specified, it will clean up ALL instrumented files.
`.trim()

export const DebugCleanupTool = Tool.define("debug_cleanup", async () => {
  return {
    description: DESCRIPTION,
    parameters: z.object({
      file_paths: z
        .array(z.string())
        .optional()
        .describe(
          "Specific file paths to clean up. If not provided, cleans up all instrumented files.",
        ),
    }),
    async execute(params, ctx) {
      const tracked = getInstrumentedFiles()
      const cleaned: string[] = []
      const errors: string[] = []

      if (tracked.size === 0) {
        return {
          title: "No files to clean up",
          metadata: { cleaned, errors, remaining: [] },
          output: "No instrumented files found. Nothing to clean up.",
        }
      }

      const filesToClean = params.file_paths ?? Array.from(tracked.keys())

      for (const filePath of filesToClean) {
        const fileInfo = tracked.get(filePath)
        if (!fileInfo) {
          if (params.file_paths) {
            errors.push(`${filePath}: Not in instrumented files list`)
          }
          continue
        }

        try {
          // Restore original content
          await fs.writeFile(filePath, fileInfo.original, "utf-8")
          tracked.delete(filePath)
          cleaned.push(filePath)
          log.info("Restored file to original", { filePath })
        } catch (e) {
          const errorMsg = e instanceof Error ? e.message : String(e)
          errors.push(`${filePath}: ${errorMsg}`)
          log.error("Failed to restore file", { filePath, error: errorMsg })
        }
      }

      const remaining = Array.from(tracked.keys())

      let output = `Debug Cleanup Complete
======================
Files restored: ${cleaned.length}
${cleaned.map((f) => `  ✓ ${f}`).join("\n")}
`

      if (errors.length > 0) {
        output += `
Errors:
${errors.map((e) => `  ✗ ${e}`).join("\n")}
`
      }

      if (remaining.length > 0) {
        output += `
Still instrumented:
${remaining.map((f) => `  • ${f}`).join("\n")}
`
      }

      return {
        title: `Cleaned up ${cleaned.length} file(s)`,
        metadata: {
          cleaned,
          errors,
          remaining,
        },
        output: output.trim(),
      }
    },
  }
})
