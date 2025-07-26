import { z } from "zod"
import * as path from "path"
import { Tool } from "./tool"
import { LSP } from "../lsp"
import { Permission } from "../permission"
import DESCRIPTION from "./write.txt"
import { App } from "../app/app"
import { Bus } from "../bus"
import { File } from "../file"
import { FileTime } from "../file/time"

export const WriteTool = Tool.define("write", {
  description: DESCRIPTION,
  parameters: z.object({
    filePath: z.string().describe("The absolute path to the file to write (must be absolute, not relative)"),
    content: z.string().describe("The content to write to the file"),
  }),
  async execute(params, ctx) {
    const app = App.info()
    const filepath = path.isAbsolute(params.filePath) ? params.filePath : path.join(app.path.cwd, params.filePath)

    const file = Bun.file(filepath)
    const exists = await file.exists()
    if (exists) await FileTime.assert(ctx.sessionID, filepath)

    await Permission.ask({
      id: "write",
      sessionID: ctx.sessionID,
      title: exists ? "Overwrite this file: " + filepath : "Create new file: " + filepath,
      metadata: {
        filePath: filepath,
        content: params.content,
        exists,
      },
    })

    await Bun.write(filepath, params.content)
    await Bus.publish(File.Event.Edited, {
      file: filepath,
    })
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
      output += `\n<project_diagnostics>\n${file}\n${issues.map(LSP.Diagnostic.pretty).join("\n")}\n</project_diagnostics>\n`
    }

    return {
      title: path.relative(app.path.root, filepath),
      metadata: {
        diagnostics,
        filepath,
        exists: exists,
      },
      output,
    }
  },
})
