import z from "zod"
import * as path from "path"
import { Tool } from "./tool"
import { LSP } from "../lsp"
import { Permission } from "../permission"
import DESCRIPTION from "./write.txt"
import { Bus } from "../bus"
import { File } from "../file"
import { FileTime } from "../file/time"
import { Filesystem } from "../util/filesystem"
import { Instance } from "../project/instance"
import { Agent } from "../agent/agent"

export const WriteTool = Tool.define("write", {
  description: DESCRIPTION,
  parameters: z.object({
    content: z.string().describe("The content to write to the file"),
    filePath: z.string().describe("The absolute path to the file to write (must be absolute, not relative)"),
  }),
  async execute(params, ctx) {
    const agent = await Agent.get(ctx.agent)

    const filepath = path.isAbsolute(params.filePath) ? params.filePath : path.join(Instance.directory, params.filePath)
    if (!Filesystem.contains(Instance.directory, filepath)) {
      const parentDir = path.dirname(filepath)
      // Secure default: only allow if explicitly set to "allow" or "ask"
      if (agent.permission.external_directory === "allow") {
        // Explicitly allowed, proceed
      } else if (agent.permission.external_directory === "ask") {
        await Permission.ask({
          type: "external_directory",
          pattern: parentDir,
          sessionID: ctx.sessionID,
          messageID: ctx.messageID,
          callID: ctx.callID,
          title: `Write file outside working directory: ${filepath}`,
          metadata: {
            filepath,
            parentDir,
          },
        })
      } else {
        // Default deny for "deny", undefined, null, or any other value
        throw new Error(`Permission denied: Cannot write file outside working directory: ${filepath}`)
      }
    }

    const file = Bun.file(filepath)
    const exists = await file.exists()
    if (exists) await FileTime.assert(ctx.sessionID, filepath)

    // Secure default: only allow if explicitly set to "allow" or "ask"
    if (agent.permission.edit === "allow") {
      // Explicitly allowed, proceed
    } else if (agent.permission.edit === "ask") {
      await Permission.ask({
        type: "write",
        sessionID: ctx.sessionID,
        messageID: ctx.messageID,
        callID: ctx.callID,
        title: exists ? "Overwrite this file: " + filepath : "Create new file: " + filepath,
        metadata: {
          filePath: filepath,
          content: params.content,
          exists,
        },
      })
    } else {
      // Default deny for "deny", undefined, null, or any other value
      throw new Error(`Permission denied: Cannot write file: ${filepath}`)
    }

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
      title: path.relative(Instance.worktree, filepath),
      metadata: {
        diagnostics,
        filepath,
        exists: exists,
      },
      output,
    }
  },
})
