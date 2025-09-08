import { z } from "zod"
import { exec, type ChildProcess } from "child_process"
import { randomUUID } from "crypto"

import { Tool } from "./tool"
import DESCRIPTION from "./bash.txt"
import { Permission } from "../permission"
import { Filesystem } from "../util/filesystem"
import { lazy } from "../util/lazy"
import { Log } from "../util/log"
import { Wildcard } from "../util/wildcard"
import { $ } from "bun"
import { Instance } from "../project/instance"
import { Agent } from "../agent/agent"

const MAX_OUTPUT_LENGTH = 30_000
const DEFAULT_TIMEOUT = 1 * 60 * 1000
const MAX_TIMEOUT = 10 * 60 * 1000
const DEFAULT_OUTPUT_TIMEOUT = 3 * 1000
const BUFFER_SOFT_LIMIT = 100 * 1024 * 1024 // 100MB
const BUFFER_HARD_LIMIT = 200 * 1024 * 1024 // 200MB
const DEFAULT_TRIM_SIZE = 1 * 1024 * 1024 // 1MB

const log = Log.create({ service: "bash-tool" })

// Process tracking
export interface RunningProcess {
  process: ChildProcess
  id: string
  output: string[]
  bufferSize: number
  readCursor: number
  metadata: {
    command: string
    startTime: number
    lastOutputTime: number
    pid: number
    bufferWarnings: number
    status: "running" | "completed" | "killed"
  }
}

export interface ProcessBufferWarning {
  processId: string
  pid: number
  command: string
  bufferSize: number
  bufferSizeMB: number
  exceededBy: number
  message: string
  autoTrimmed?: boolean
}

// Global process tracking
export const runningProcesses = new Map<string, RunningProcess>()

// Helper functions
function checkBufferWarnings(): ProcessBufferWarning[] {
  const warnings: ProcessBufferWarning[] = []

  for (const [id, proc] of runningProcesses.entries()) {
    if (proc.bufferSize > BUFFER_SOFT_LIMIT) {
      warnings.push({
        processId: id,
        pid: proc.metadata.pid,
        command: proc.metadata.command.slice(0, 50) + (proc.metadata.command.length > 50 ? "..." : ""),
        bufferSize: proc.bufferSize,
        bufferSizeMB: Math.round(proc.bufferSize / 1024 / 1024),
        exceededBy: proc.bufferSize - BUFFER_SOFT_LIMIT,
        message: `Process ${id} buffer exceeds 100MB. Use process_trim to reduce.`,
        autoTrimmed: proc.bufferSize > BUFFER_HARD_LIMIT,
      })

      proc.metadata.bufferWarnings++

      // Auto-trim if exceeds hard limit
      if (proc.bufferSize > BUFFER_HARD_LIMIT) {
        trimBuffer(id, DEFAULT_TRIM_SIZE)
      }
    }
  }

  return warnings
}

export function trimBuffer(processId: string, retainSize: number): void {
  const proc = runningProcesses.get(processId)
  if (!proc) return

  const fullOutput = proc.output.join("")
  if (fullOutput.length > retainSize) {
    const keepFrom = fullOutput.length - retainSize
    const retained = fullOutput.slice(keepFrom)
    proc.output = [retained]
    proc.bufferSize = retained.length
    proc.readCursor = 0 // Reset cursor since we trimmed
    log.info("auto-trimmed buffer", { processId, newSize: proc.bufferSize })
  }
}

const parser = lazy(async () => {
  try {
    const { default: Parser } = await import("tree-sitter")
    const Bash = await import("tree-sitter-bash")
    const p = new Parser()
    p.setLanguage(Bash.language as any)
    return p
  } catch (e) {
    const { default: Parser } = await import("web-tree-sitter")
    const { default: treeWasm } = await import("web-tree-sitter/tree-sitter.wasm" as string, { with: { type: "wasm" } })
    await Parser.init({
      locateFile() {
        return treeWasm
      },
    })
    const { default: bashWasm } = await import("tree-sitter-bash/tree-sitter-bash.wasm" as string, {
      with: { type: "wasm" },
    })
    const bashLanguage = await Parser.Language.load(bashWasm)
    const p = new Parser()
    p.setLanguage(bashLanguage)
    return p
  }
})

const bashParameters = z.object({
  command: z.string().describe("The command to execute"),
  timeout: z.number().describe("Optional timeout in milliseconds").optional(),
  outputTimeout: z
    .number()
    .describe("Timeout in milliseconds to wait for output before backgrounding process")
    .optional(),
  description: z
    .string()
    .describe(
      "Clear, concise description of what this command does in 5-10 words. Examples:\nInput: ls\nOutput: Lists files in current directory\n\nInput: git status\nOutput: Shows working tree status\n\nInput: npm install\nOutput: Installs package dependencies\n\nInput: mkdir foo\nOutput: Creates directory 'foo'",
    ),
})

interface BashMetadata {
  output: string
  exit?: number | null
  status?: "background" | "completed"
  processId?: string
  pid?: number
  message?: string
  description: string
  bufferWarnings?: ProcessBufferWarning[]
}

export const BashTool = Tool.define<typeof bashParameters, BashMetadata>("bash", {
  description: DESCRIPTION,
  parameters: bashParameters,
  async execute(params, ctx) {
    const timeout = Math.min(params.timeout ?? DEFAULT_TIMEOUT, MAX_TIMEOUT)
    const outputTimeout = params.outputTimeout ?? DEFAULT_OUTPUT_TIMEOUT
    const tree = await parser().then((p) => p.parse(params.command))
    const permissions = await Agent.get(ctx.agent).then((x) => x.permission.bash)

    let needsAsk = false
    for (const node of tree.rootNode.descendantsOfType("command")) {
      const command = []
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i)
        if (!child) continue
        if (
          child.type !== "command_name" &&
          child.type !== "word" &&
          child.type !== "string" &&
          child.type !== "raw_string" &&
          child.type !== "concatenation"
        ) {
          continue
        }
        command.push(child.text)
      }

      // not an exhaustive list, but covers most common cases
      if (["cd", "rm", "cp", "mv", "mkdir", "touch", "chmod", "chown"].includes(command[0])) {
        for (const arg of command.slice(1)) {
          if (arg.startsWith("-") || (command[0] === "chmod" && arg.startsWith("+"))) continue
          const resolved = await $`realpath ${arg}`
            .quiet()
            .nothrow()
            .text()
            .then((x) => x.trim())
          log.info("resolved path", { arg, resolved })
          if (resolved && !Filesystem.contains(Instance.directory, resolved)) {
            throw new Error(
              `This command references paths outside of ${Instance.directory} so it is not allowed to be executed.`,
            )
          }
        }
      }

      // always allow cd if it passes above check
      if (!needsAsk && command[0] !== "cd") {
        const action = Wildcard.all(node.text, permissions)
        if (action === "deny") {
          throw new Error(
            `The user has specifically restricted access to this command, you are not allowed to execute it. Here is the configuration: ${JSON.stringify(permissions)}`,
          )
        }
        if (action === "ask") needsAsk = true
      }
    }

    if (needsAsk) {
      await Permission.ask({
        type: "bash",
        pattern: params.command,
        sessionID: ctx.sessionID,
        messageID: ctx.messageID,
        callID: ctx.callID,
        title: params.command,
        metadata: {
          command: params.command,
        },
      })
    }

    // Check buffer warnings before executing
    const bufferWarnings = checkBufferWarnings()

    let hasReturned = false
    let outputBuffer = ""
    let lastOutputTime = Date.now()
    const processId = randomUUID()

    // Start the process
    const process = exec(params.command, {
      cwd: Instance.directory,
      signal: ctx.abort,
      // Don't use timeout option here - we handle it ourselves
    })

    if (!process.pid) {
      throw new Error("Failed to start process")
    }

    // Initialize metadata with empty output
    ctx.metadata({
      metadata: {
        output: "",
        description: params.description,
        bufferWarnings: bufferWarnings.length > 0 ? bufferWarnings : undefined,
      },
    })

    // Set up output handlers
    process.stdout?.on("data", (chunk) => {
      lastOutputTime = Date.now()
      const text = chunk.toString()
      outputBuffer += text

      // Update tracked process if it exists
      const tracked = runningProcesses.get(processId)
      if (tracked) {
        tracked.output.push(text)
        tracked.bufferSize += text.length
        tracked.metadata.lastOutputTime = lastOutputTime
      }

      // Update live metadata if not yet returned
      if (!hasReturned) {
        ctx.metadata({
          metadata: {
            output: outputBuffer,
            description: params.description,
            bufferWarnings: bufferWarnings.length > 0 ? bufferWarnings : undefined,
          },
        })
      }
    })

    process.stderr?.on("data", (chunk) => {
      lastOutputTime = Date.now()
      const text = chunk.toString()
      outputBuffer += text

      // Update tracked process if it exists
      const tracked = runningProcesses.get(processId)
      if (tracked) {
        tracked.output.push(text)
        tracked.bufferSize += text.length
        tracked.metadata.lastOutputTime = lastOutputTime
      }

      // Update live metadata if not yet returned
      if (!hasReturned) {
        ctx.metadata({
          metadata: {
            output: outputBuffer,
            description: params.description,
            bufferWarnings: bufferWarnings.length > 0 ? bufferWarnings : undefined,
          },
        })
      }
    })

    // Create promise for process completion
    const processComplete = new Promise<number | null>((resolve) => {
      process.on("close", (code) => {
        resolve(code)
      })
    })

    // Create promise for output timeout
    const timeoutPromise = new Promise<"timeout">((resolve) => {
      const checkInterval = setInterval(() => {
        if (Date.now() - lastOutputTime > outputTimeout && !hasReturned) {
          clearInterval(checkInterval)
          resolve("timeout")
        }
      }, 500)

      // Clean up interval if process completes
      processComplete.then(() => clearInterval(checkInterval))
    })

    // Create promise for hard timeout
    const hardTimeoutPromise = new Promise<"hard-timeout">((resolve) => {
      setTimeout(() => {
        if (!hasReturned) {
          resolve("hard-timeout")
        }
      }, timeout)
    })

    // Race between completion, output timeout, and hard timeout
    const result = await Promise.race([processComplete, timeoutPromise, hardTimeoutPromise])

    if ((result === "timeout" || result === "hard-timeout") && !hasReturned) {
      hasReturned = true

      // Track the process for future interaction
      runningProcesses.set(processId, {
        process,
        id: processId,
        output: outputBuffer ? [outputBuffer] : [],
        bufferSize: outputBuffer.length,
        readCursor: 0,
        metadata: {
          command: params.command,
          startTime: Date.now(),
          lastOutputTime,
          pid: process.pid!,
          bufferWarnings: 0,
          status: "running",
        },
      })

      // Continue capturing output in background
      process.on("close", (code) => {
        const tracked = runningProcesses.get(processId)
        if (tracked) {
          tracked.metadata.status = "completed"
          log.info("background process completed", { processId, code })
        }
      })

      // Truncate output if needed
      if (outputBuffer.length > MAX_OUTPUT_LENGTH) {
        outputBuffer = outputBuffer.slice(0, MAX_OUTPUT_LENGTH) + "\n\n(Output was truncated due to length limit)"
      }

      const timeoutType = result === "timeout" ? "output timeout" : "execution timeout"

      // Return early with special metadata
      return {
        title: params.command,
        metadata: {
          output: outputBuffer,
          status: "background",
          processId,
          pid: process.pid,
          message: `Process continues running in background (${timeoutType}). Use process_list to check status.`,
          description: params.description,
          bufferWarnings: bufferWarnings.length > 0 ? bufferWarnings : undefined,
        },
        output:
          outputBuffer ||
          `Process started in background (${timeoutType}). Process ID: ${processId}, PID: ${process.pid}`,
      }
    }

    // Normal completion
    hasReturned = true

    // Update metadata with final status
    ctx.metadata({
      metadata: {
        output: outputBuffer,
        exit: process.exitCode,
        description: params.description,
        bufferWarnings: bufferWarnings.length > 0 ? bufferWarnings : undefined,
      },
    })

    // Truncate output if needed
    if (outputBuffer.length > MAX_OUTPUT_LENGTH) {
      outputBuffer = outputBuffer.slice(0, MAX_OUTPUT_LENGTH) + "\n\n(Output was truncated due to length limit)"
    }

    return {
      title: params.command,
      metadata: {
        output: outputBuffer,
        exit: process.exitCode,
        status: "completed",
        description: params.description,
        bufferWarnings: bufferWarnings.length > 0 ? bufferWarnings : undefined,
      },
      output: outputBuffer,
    }
  },
})
