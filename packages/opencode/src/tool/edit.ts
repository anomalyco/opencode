// the approaches in this edit tool are sourced from
// https://github.com/cline/cline/blob/main/evals/diff-edits/diff-apply/diff-06-23-25.ts
// https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/utils/editCorrector.ts

import { z } from "zod"
import * as path from "path"
import { Tool } from "./tool"
import { LSP } from "../lsp"
import { createTwoFilesPatch } from "diff"
import { Permission } from "../permission"
import DESCRIPTION from "./edit.txt"
import { App } from "../app/app"
import { File } from "../file"
import { Bus } from "../bus"
import { FileTime } from "../file/time"
import { ReplaceStrategy } from "./replace-strategy"

const replaceStrategy = new ReplaceStrategy()

export const EditTool = Tool.define({
  id: "edit",
  description: DESCRIPTION,
  parameters: z.object({
    filePath: z.string().describe("The absolute path to the file to modify"),
    oldString: z.string().describe("The text to replace"),
    newString: z.string().describe("The text to replace it with (must be different from oldString)"),
    replaceAll: z.boolean().optional().describe("Replace all occurrences of oldString (default false)"),
  }),
  async execute(params, ctx) {
    if (!params.filePath) {
      throw new Error("filePath is required")
    }

    if (params.oldString === params.newString) {
      throw new Error("oldString and newString must be different")
    }

    const app = App.info()
    const filepath = path.isAbsolute(params.filePath) ? params.filePath : path.join(app.path.cwd, params.filePath)

    await Permission.ask({
      id: "edit",
      sessionID: ctx.sessionID,
      title: "Edit this file: " + filepath,
      metadata: {
        filePath: filepath,
        oldString: params.oldString,
        newString: params.newString,
      },
    })

    let contentOld = ""
    let contentNew = ""
    await (async () => {
      if (params.oldString === "") {
        contentNew = params.newString
        await Bun.write(filepath, params.newString)
        await Bus.publish(File.Event.Edited, {
          file: filepath,
        })
        return
      }

      const file = Bun.file(filepath)
      const stats = await file.stat().catch(() => {})
      if (!stats) throw new Error(`File ${filepath} not found`)
      if (stats.isDirectory()) throw new Error(`Path is a directory, not a file: ${filepath}`)
      await FileTime.assert(ctx.sessionID, filepath)
      contentOld = await file.text()

      contentNew = replaceStrategy.replace(contentOld, params.oldString, params.newString, params.replaceAll)
      await file.write(contentNew)
      await Bus.publish(File.Event.Edited, {
        file: filepath,
      })
      contentNew = await file.text()
    })()

    const diff = trimDiff(createTwoFilesPatch(filepath, filepath, contentOld, contentNew))

    FileTime.read(ctx.sessionID, filepath)

    let output = ""
    await LSP.touchFile(filepath, true)
    const diagnostics = await LSP.diagnostics()
    for (const [file, issues] of Object.entries(diagnostics)) {
      if (issues.length === 0) continue
      if (file === filepath) {
        output += `\nThis file has errors, please fix\n<file_diagnostics>\n${issues.map(LSP.Diagnostic.pretty).join("\n")}\n</file_diagnostics>\n`
        continue
      }
      output += `\n<project_diagnostics>\n${file}\n${issues
        .filter((item) => item.severity === 1)
        .map(LSP.Diagnostic.pretty)
        .join("\n")}\n</project_diagnostics>\n`
    }

    return {
      metadata: {
        diagnostics,
        diff,
      },
      title: `${path.relative(app.path.root, filepath)}`,
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
