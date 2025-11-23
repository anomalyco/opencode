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
import { Log } from "../util/log"

const log = Log.create({ service: "tool.write" })

const HEARTBEAT_INTERVAL = 30 * 1000 // 30 seconds
const HEARTBEAT_MESSAGE_PREFIX = "tool.write.heartbeat"

export const WriteTool = Tool.define("write", {
  description: DESCRIPTION,
  parameters: z.object({
    content: z.string().describe("The content to write to the file"),
    filePath: z.string().describe("The absolute path to the file to write (must be absolute, not relative)"),
    heartbeat: z.boolean().describe("Enable heartbeat updates during long writes").optional(),
  }),
  async execute(params, ctx) {
    const agent = await Agent.get(ctx.agent)
    const startTime = Date.now()
    let heartbeatInterval: NodeJS.Timeout | undefined

    const filepath = path.isAbsolute(params.filePath) ? params.filePath : path.join(Instance.directory, params.filePath)
    if (!Filesystem.contains(Instance.directory, filepath)) {
      const parentDir = path.dirname(filepath)
      if (agent.permission.external_directory === "ask") {
        await Permission.ask({
          type: "external_directory",
          pattern: [parentDir, path.join(parentDir, "*")],
          sessionID: ctx.sessionID,
          messageID: ctx.messageID,
          callID: ctx.callID,
          title: `Write file outside working directory: ${filepath}`,
          metadata: {
            filepath,
            parentDir,
          },
        })
      } else if (agent.permission.external_directory === "deny") {
        throw new Permission.RejectedError(
          ctx.sessionID,
          "external_directory",
          ctx.callID,
          {
            filepath,
            parentDir,
          },
          `File ${filepath} is not in the current working directory`,
        )
      }
    }

    const file = Bun.file(filepath)
    const exists = await file.exists()
    if (exists) await FileTime.assert(ctx.sessionID, filepath)

    if (agent.permission.edit === "ask")
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

    const shouldUseHeartbeat = params.heartbeat || params.content.length > 10
    let lastHeartbeat = 0
    
    if (shouldUseHeartbeat) {
      log.info("heartbeat.start", {
        sessionID: ctx.sessionID,
        callID: ctx.callID,
        contentLength: params.content.length,
        filepath
      })
      
      heartbeatInterval = setInterval(() => {
        const now = Date.now()
        const elapsed = now - lastHeartbeat
        
        // Send heartbeat message
        ctx.metadata({
          metadata: {
            title: "Writing file...",
            heartbeat: true,
            elapsed: elapsed,
            progress: "in_progress",
            bytesWritten: 0,
            totalBytes: params.content.length,
            filepath,
          },
        })
        
        lastHeartbeat = now
        log.debug("heartbeat.sent", {
          sessionID: ctx.sessionID,
          callID: ctx.callID,
          elapsed,
          filepath
        })
      }, HEARTBEAT_INTERVAL)
    }

    try {
      await Bun.write(filepath, params.content)
      
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval)
        log.info("heartbeat.complete", {
          sessionID: ctx.sessionID,
          callID: ctx.callID,
          duration: Date.now() - startTime,
          filepath
        })
      }
      
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
          heartbeat: shouldUseHeartbeat,
          duration: Date.now() - startTime,
        },
        output,
      }
    } catch (error) {
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval)
      }
      
      log.error("write.error", {
        sessionID: ctx.sessionID,
        callID: ctx.callID,
        filepath,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      })
      
      throw error
    }
  },
})
