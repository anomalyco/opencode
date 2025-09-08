import { z } from "zod"
import { Tool } from "./tool"
import { runningProcesses } from "./bash"
import { Log } from "../util/log"

const log = Log.create({ service: "process-interact-tool" })

const DESCRIPTION = `Send input or signals to a background process.

This tool allows interaction with processes running in the background:
- stdin: Send text input to the process
- signal: Send a signal (SIGTERM, SIGKILL, SIGINT, etc.)
- kill: Forcefully terminate the process
`

interface ProcessInteractMetadata {
  success: boolean
  message: string
  processId: string
  pid: number
  action: string
  data?: string
}

const interactParameters = z.object({
  processId: z.string().describe("Process ID from bash command"),
  action: z.enum(["stdin", "signal", "kill"]).describe("Interaction type"),
  data: z.string().optional().describe("Input text for stdin or signal name (e.g., SIGTERM, SIGINT)"),
})

export const ProcessInteractTool = Tool.define<typeof interactParameters, ProcessInteractMetadata>("process_interact", {
  description: DESCRIPTION,
  parameters: interactParameters,

  async execute(params, _ctx) {
    const proc = runningProcesses.get(params.processId)
    if (!proc) {
      throw new Error(`Process ${params.processId} not found`)
    }

    let success = false
    let message = ""

    switch (params.action) {
      case "stdin": {
        if (!params.data) {
          throw new Error("stdin action requires data parameter")
        }

        if (proc.process.stdin) {
          try {
            const writeSuccess = proc.process.stdin.write(params.data + "\n")
            if (writeSuccess) {
              success = true
              message = `Sent ${params.data.length} characters to process stdin`

              // Log the stdin interaction
              const inputLog = `[STDIN] ${params.data}\n`
              proc.output.push(inputLog)
              proc.bufferSize += inputLog.length
              proc.metadata.lastOutputTime = Date.now()
            } else {
              message = "Failed to write to stdin - buffer may be full"
            }
          } catch (error) {
            message = `Failed to write to stdin: ${error instanceof Error ? error.message : String(error)}`
          }
        } else {
          message = "Process stdin is not available"
        }
        break
      }

      case "signal": {
        const signal = params.data || "SIGTERM"
        try {
          const killed = proc.process.kill(signal as any)
          if (killed) {
            success = true
            message = `Signal ${signal} sent successfully`
            log.info("signal sent", { processId: params.processId, signal })

            // Update status if it's a terminating signal
            if (["SIGTERM", "SIGKILL", "SIGINT", "SIGQUIT"].includes(signal)) {
              proc.metadata.status = "killed"
            }
          } else {
            message = `Failed to send signal ${signal}`
          }
        } catch (error) {
          message = `Error sending signal: ${error instanceof Error ? error.message : String(error)}`
        }
        break
      }

      case "kill": {
        try {
          const killed = proc.process.kill("SIGKILL")
          if (killed) {
            success = true
            message = "Process killed successfully"
            proc.metadata.status = "killed"

            // Clean up after a delay to ensure process has time to die
            setTimeout(() => {
              runningProcesses.delete(params.processId)
              log.info("process removed from tracking", { processId: params.processId })
            }, 1000)
          } else {
            message = "Process may have already exited"
          }
        } catch (error) {
          message = `Error killing process: ${error instanceof Error ? error.message : String(error)}`
        }
        break
      }
    }

    return {
      title: `Process ${params.action}: ${params.processId}`,
      metadata: {
        success,
        message,
        processId: params.processId,
        pid: proc.metadata.pid,
        action: params.action,
        data: params.data,
      },
      output: message,
    }
  },
})
