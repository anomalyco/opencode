import { z } from "zod"
import { Tool } from "./tool"
import { runningProcesses } from "./bash"

const DESCRIPTION = `Read output from a background process with stream-like functionality.

This tool provides different ways to read output from processes running in the background:
- read: Consume and return unread output (default)
- peek: View unread output without consuming it
- tail: Get the most recent output regardless of read position
- reset: Reset the read cursor to the beginning
`

interface ProcessStreamMetadata {
  output: string
  consumed: boolean
  processId: string
  pid: number
  bytesRead: number
  unreadBytes: number
  totalBytes: number
  bufferStatus: "OK" | "WARNING"
}

const streamParameters = z.object({
  processId: z.string().describe("Process ID from bash command"),
  action: z.enum(["read", "peek", "tail", "reset"]).describe("Stream action to perform").default("read"),
  maxBytes: z.number().optional().describe("Maximum bytes to read (default: all available)"),
})

export const ProcessStreamTool = Tool.define<typeof streamParameters, ProcessStreamMetadata>("process_stream", {
  description: DESCRIPTION,
  parameters: streamParameters,

  async execute(params, _ctx) {
    const proc = runningProcesses.get(params.processId)
    if (!proc) {
      throw new Error(`Process ${params.processId} not found`)
    }

    let output = ""
    let consumed = false
    let bytesRead = 0

    switch (params.action) {
      case "read": {
        // Consume and return unread data
        const unread = proc.output.slice(proc.readCursor)
        const unreadText = unread.join("")
        output = params.maxBytes ? unreadText.slice(0, params.maxBytes) : unreadText
        bytesRead = output.length

        // Update cursor to mark as read
        const newChunksRead = unread.slice(0, Math.ceil((bytesRead / unreadText.length) * unread.length))
        proc.readCursor += newChunksRead.length
        consumed = true
        break
      }

      case "peek": {
        // Return unread data without consuming
        const unreadText = proc.output.slice(proc.readCursor).join("")
        output = params.maxBytes ? unreadText.slice(0, params.maxBytes) : unreadText
        bytesRead = output.length
        consumed = false
        break
      }

      case "tail": {
        // Get last N bytes regardless of read cursor
        const allText = proc.output.join("")
        const tailBytes = params.maxBytes || 10000
        output = allText.length > tailBytes ? allText.slice(-tailBytes) : allText
        bytesRead = output.length
        consumed = false
        break
      }

      case "reset": {
        // Reset read cursor to beginning
        proc.readCursor = 0
        output = "Read cursor reset to beginning"
        consumed = false
        bytesRead = 0
        break
      }
    }

    const unreadBytes = proc.output.slice(proc.readCursor).join("").length
    const bufferStatus = proc.bufferSize > 100 * 1024 * 1024 ? "WARNING" : "OK"

    return {
      title: `Process stream: ${params.action}`,
      metadata: {
        output,
        consumed,
        processId: params.processId,
        pid: proc.metadata.pid,
        bytesRead,
        unreadBytes,
        totalBytes: proc.bufferSize,
        bufferStatus,
      },
      output: params.action === "reset" ? output : output || "(no output)",
    }
  },
})
