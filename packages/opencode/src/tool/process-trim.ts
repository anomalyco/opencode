import { z } from "zod"
import { Tool } from "./tool"
import { runningProcesses, trimBuffer } from "./bash"

const DESCRIPTION = `Trim the output buffer of a background process to save memory.

This tool helps manage memory usage by trimming process output buffers:
- Retain a specified amount of recent output (default 1MB, max 100MB)
- Choose to keep either the most recent output or unread output
- Automatically resets read cursor when trimming
`

interface ProcessTrimMetadata {
  success: boolean
  processId: string
  pid: number
  beforeSize: number
  afterSize: number
  freedBytes: number
  freedMB: number
  retainMode: "recent" | "unread"
}

const BUFFER_SOFT_LIMIT = 100 * 1024 * 1024 // 100MB
const DEFAULT_TRIM_SIZE = 1 * 1024 * 1024 // 1MB

const trimParameters = z.object({
  processId: z.string().describe("Process ID to trim"),
  retainSize: z.number().optional().describe("Bytes to retain (max 100MB, default 1MB)"),
  retainMode: z.enum(["recent", "unread"]).optional().describe("What to keep: 'recent' (default) or 'unread' output"),
})

export const ProcessTrimTool = Tool.define<typeof trimParameters, ProcessTrimMetadata>("process_trim", {
  description: DESCRIPTION,
  parameters: trimParameters,

  async execute(params, _ctx) {
    const proc = runningProcesses.get(params.processId)
    if (!proc) {
      throw new Error(`Process ${params.processId} not found`)
    }

    const retainSize = Math.min(params.retainSize || DEFAULT_TRIM_SIZE, BUFFER_SOFT_LIMIT)
    const mode = params.retainMode || "recent"
    const beforeSize = proc.bufferSize

    if (mode === "recent") {
      // Use the shared trimBuffer function for recent mode
      trimBuffer(params.processId, retainSize)
    } else if (mode === "unread") {
      // Keep unread portion up to limit
      const unreadOutput = proc.output.slice(proc.readCursor).join("")
      if (unreadOutput.length > retainSize) {
        // Keep only the most recent part of unread output
        proc.output = [unreadOutput.slice(-retainSize)]
      } else {
        // Keep all unread output
        proc.output = [unreadOutput]
      }
      proc.bufferSize = proc.output[0].length
      proc.readCursor = 0
    }

    const afterSize = proc.bufferSize
    const freedBytes = beforeSize - afterSize

    return {
      title: `Trimmed process buffer: ${params.processId}`,
      metadata: {
        success: true,
        processId: params.processId,
        pid: proc.metadata.pid,
        beforeSize,
        afterSize,
        freedBytes,
        freedMB: Math.round((freedBytes / 1024 / 1024) * 100) / 100,
        retainMode: mode,
      },
      output: `Buffer trimmed from ${(beforeSize / 1024 / 1024).toFixed(2)}MB to ${(afterSize / 1024 / 1024).toFixed(2)}MB (freed ${(freedBytes / 1024 / 1024).toFixed(2)}MB)`,
    }
  },
})
