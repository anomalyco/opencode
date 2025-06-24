import { z } from "zod"
import * as path from "path"
import { Tool } from "./tool"
import { FileTimes } from "./util/file-times"
import { LSP } from "../lsp"
import { createTwoFilesPatch } from "diff"
import { Permission } from "../permission"
import DESCRIPTION from "./multifileedit.txt"
import { App } from "../app/app"

const FileEditSchema = z.object({
  filePath: z.string().describe("The absolute path to the file to modify"),
  oldString: z.string().describe("The text to replace"),
  newString: z
    .string()
    .describe(
      "The text to replace it with (must be different from old_string)",
    ),
  replaceAll: z
    .boolean()
    .optional()
    .describe("Replace all occurrences of old_string (default false)"),
})

export const MultiFileEditTool = Tool.define({
  id: "multifileedit",
  description: DESCRIPTION,
  parameters: z.object({
    edits: z
      .array(FileEditSchema)
      .describe("Array of edit operations to perform on different files"),
  }),
  async execute(params, ctx) {
    const app = App.info()
    const results = []
    const errors = []

    // First, ask for permission for all file edits
    for (const edit of params.edits) {
      const filepath = path.isAbsolute(edit.filePath)
        ? edit.filePath
        : path.join(app.path.cwd, edit.filePath)

      await Permission.ask({
        id: "edit",
        sessionID: ctx.sessionID,
        title: "Edit this file: " + filepath,
        metadata: {
          filePath: filepath,
          oldString: edit.oldString,
          newString: edit.newString,
        },
      })
    }

    // Process each edit
    for (const edit of params.edits) {
      try {
        const filepath = path.isAbsolute(edit.filePath)
          ? edit.filePath
          : path.join(app.path.cwd, edit.filePath)

        let contentOld = ""
        let contentNew = ""

        if (edit.oldString === "") {
          // Creating a new file
          contentNew = edit.newString
          await Bun.write(filepath, edit.newString)
        } else {
          // Editing existing file
          const file = Bun.file(filepath)
          if (!(await file.exists())) {
            errors.push(`File ${filepath} not found`)
            continue
          }
          
          const stats = await file.stat()
          if (stats.isDirectory()) {
            errors.push(`Path is a directory, not a file: ${filepath}`)
            continue
          }
          
          await FileTimes.assert(ctx.sessionID, filepath)
          contentOld = await file.text()
          const index = contentOld.indexOf(edit.oldString)
          
          if (index === -1) {
            errors.push(
              `oldString not found in file ${filepath}. Make sure it matches exactly, including whitespace and line breaks`,
            )
            continue
          }

          if (edit.replaceAll) {
            contentNew = contentOld.replaceAll(edit.oldString, edit.newString)
          } else {
            const lastIndex = contentOld.lastIndexOf(edit.oldString)
            if (index !== lastIndex) {
              errors.push(
                `oldString appears multiple times in file ${filepath}. Please provide more context to ensure a unique match or use replaceAll`,
              )
              continue
            }

            contentNew =
              contentOld.substring(0, index) +
              edit.newString +
              contentOld.substring(index + edit.oldString.length)
          }

          await Bun.write(filepath, contentNew)
        }

        const diff = trimDiff(
          createTwoFilesPatch(filepath, filepath, contentOld, contentNew),
        )

        FileTimes.read(ctx.sessionID, filepath)

        // Check for diagnostics
        await LSP.touchFile(filepath, true)
        const diagnostics = await LSP.diagnostics()
        const fileDiagnostics = diagnostics[filepath] || []
        
        results.push({
          filePath: filepath,
          relativePath: path.relative(app.path.root, filepath),
          diff,
          diagnostics: fileDiagnostics,
          success: true
        })

      } catch (error) {
        errors.push(`Error editing ${edit.filePath}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    // Collect all diagnostics after all edits
    const allDiagnostics = await LSP.diagnostics()
    
    let output = ""
    if (results.length > 0) {
      output += `Successfully edited ${results.length} file(s):\n\n`
      
      for (const result of results) {
        output += `<file_edit path="${result.relativePath}">\n`
        output += result.diff
        output += "\n</file_edit>\n\n"
        
        if (result.diagnostics.length > 0) {
          output += `<file_diagnostics path="${result.relativePath}">\n`
          output += result.diagnostics.map(LSP.Diagnostic.pretty).join("\n")
          output += "\n</file_diagnostics>\n\n"
        }
      }
    }

    if (errors.length > 0) {
      output += `\nErrors encountered:\n${errors.join("\n")}\n`
    }

    // Add project-wide diagnostics for other affected files
    for (const [file, issues] of Object.entries(allDiagnostics)) {
      if (issues.length === 0) continue
      
      // Skip files we already reported on
      if (results.some(r => r.filePath === file)) continue
      
      output += `\n<project_diagnostics path="${path.relative(app.path.root, file)}">\n`
      output += issues.map(LSP.Diagnostic.pretty).join("\n")
      output += "\n</project_diagnostics>\n"
    }

    return {
      metadata: {
        filesEdited: results.length,
        errors: errors.length,
        diagnostics: allDiagnostics,
        files: results.map(r => ({
          path: r.relativePath,
          diff: r.diff
        })),
        title: `Edited ${results.length} file(s)${errors.length > 0 ? ` (${errors.length} errors)` : ''}`,
      },
      output,
    }
  },
})

function trimDiff(diff: string): string {
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