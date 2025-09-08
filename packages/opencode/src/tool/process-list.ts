import { z } from "zod"
import { Tool } from "./tool"
import { runningProcesses } from "./bash"

const DESCRIPTION = `List all running background processes started by bash commands.

This tool shows all processes that are currently running in the background after being started by the bash tool.
It includes information about their runtime, buffer size, and status.
`

interface ProcessListMetadata {
  processes: Array<{
    id: string
    pid: number
    command: string
    running: boolean
    runtime: number
    bufferSize: number
    bufferSizeMB: string
    bufferStatus: "OK" | "WARNING"
    unreadBytes: number
    warningCount: number
  }>
  globalStats: {
    totalBufferSize: number
    processCount: number
  }
}

export const ProcessListTool = Tool.define<z.ZodObject<{}>, ProcessListMetadata>("process_list", {
  description: DESCRIPTION,
  parameters: z.object({}),

  async execute(_params, _ctx) {
    const processes = []

    for (const [id, proc] of runningProcesses.entries()) {
      processes.push({
        id,
        pid: proc.metadata.pid,
        command: proc.metadata.command,
        running: proc.metadata.status === "running",
        runtime: Date.now() - proc.metadata.startTime,
        bufferSize: proc.bufferSize,
        bufferSizeMB: (proc.bufferSize / 1024 / 1024).toFixed(2),
        bufferStatus: (proc.bufferSize > 100 * 1024 * 1024 ? "WARNING" : "OK") as "OK" | "WARNING",
        unreadBytes: proc.output.slice(proc.readCursor).join("").length,
        warningCount: proc.metadata.bufferWarnings,
      })
    }

    const globalStats = {
      totalBufferSize: Array.from(runningProcesses.values()).reduce((sum, p) => sum + p.bufferSize, 0),
      processCount: runningProcesses.size,
    }

    return {
      title: "Background process list",
      metadata: {
        processes,
        globalStats,
      },
      output:
        processes.length === 0
          ? "No background processes running"
          : processes
              .map(
                (p) =>
                  `${p.running ? "🟢" : "⚫"} [${p.id}] PID:${p.pid} - ${p.command.slice(0, 50)}${p.command.length > 50 ? "..." : ""}\n` +
                  `  Runtime: ${Math.floor(p.runtime / 1000)}s | Buffer: ${p.bufferSizeMB}MB (${p.bufferStatus})`,
              )
              .join("\n\n"),
    }
  },
})
