import z from "zod"
import { spawn } from "child_process"
import { Tool } from "./tool"
import path from "path"
import DESCRIPTION from "./bash.txt"
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { lazy } from "@/util/lazy"
import { Language } from "web-tree-sitter"

import { $ } from "bun"
import { Filesystem } from "@/util/filesystem"
import { fileURLToPath } from "url"
import { Flag } from "@/flag/flag.ts"
import { Shell } from "@/shell/shell"

import { BashArity } from "@/permission/arity"
import { Truncate } from "./truncation"
import { TaskManager } from "@/task"
import type { ChildProcess } from "child_process"

const MAX_METADATA_LENGTH = 30_000
const DEFAULT_TIMEOUT = Flag.OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS || 2 * 60 * 1000

export const log = Log.create({ service: "bash-tool" })

/**
 * Registry of foreground bash processes that can be migrated to background
 */
export interface ForegroundProcess {
  callID: string
  sessionID: string
  pid: number
  command: string
  description: string
  workdir: string
  startTime: number
  process: ChildProcess
  output: string
  /** Resolver to complete the tool execution after migration */
  resolve: (result: { migrated: true; taskId: string }) => void
  /** Flag to prevent normal completion after migration */
  migrated: boolean
}

const foregroundProcesses = Instance.state(
  () => new Map<string, ForegroundProcess>(),
  async (processes) => {
    // Cleanup: kill any remaining foreground processes on instance disposal
    for (const proc of processes.values()) {
      if (!proc.migrated && proc.process.exitCode === null) {
        try {
          proc.process.kill()
        } catch {
          // ignore
        }
      }
    }
    processes.clear()
  },
)

/**
 * Get a foreground process by callID
 */
export function getForegroundProcess(callID: string): ForegroundProcess | undefined {
  return foregroundProcesses().get(callID)
}

/**
 * List all active foreground processes
 */
export function listForegroundProcesses(): ForegroundProcess[] {
  return Array.from(foregroundProcesses().values()).filter(
    (p) => !p.migrated && p.process.exitCode === null,
  )
}

/**
 * Register a foreground process (for shell commands executed outside BashTool)
 * @param proc - Process info
 * @param resolve - Optional callback to invoke when process is migrated to background
 */
export function registerForegroundProcess(
  proc: Omit<ForegroundProcess, "resolve" | "migrated">,
  resolve?: (result: { migrated: true; taskId: string }) => void,
): void {
  foregroundProcesses().set(proc.callID, {
    ...proc,
    resolve: resolve ?? (() => {}),
    migrated: false,
  })
}

/**
 * Unregister a foreground process
 */
export function unregisterForegroundProcess(callID: string): void {
  foregroundProcesses().delete(callID)
}

/**
 * Migrate a foreground process to a background task
 * Returns the new task ID if successful
 */
export async function migrateToBackground(callID: string): Promise<string | null> {
  const proc = foregroundProcesses().get(callID)
  if (!proc) {
    log.warn("cannot migrate unknown process", { callID })
    return null
  }

  if (proc.migrated) {
    log.warn("process already migrated", { callID })
    return null
  }

  if (proc.process.exitCode !== null) {
    log.warn("cannot migrate completed process", { callID, exitCode: proc.process.exitCode })
    return null
  }

  log.info("migrating foreground process to background", {
    callID,
    pid: proc.pid,
    command: proc.command,
  })

  // Adopt the process into TaskManager
  const task = await TaskManager.adopt({
    process: proc.process,
    command: proc.command,
    workdir: proc.workdir,
    description: proc.description,
    initialOutput: proc.output,
    startTime: proc.startTime,
  })

  // Mark as migrated
  proc.migrated = true

  // Resolve the original tool execution with migration info
  proc.resolve({ migrated: true, taskId: task.id })

  // Remove from foreground registry
  foregroundProcesses().delete(callID)

  log.info("process migrated to background task", { callID, taskId: task.id })

  return task.id
}

/**
 * Kill a foreground process
 */
export async function killForegroundProcess(callID: string): Promise<boolean> {
  const proc = foregroundProcesses().get(callID)
  if (!proc) {
    return false
  }

  if (proc.process.exitCode !== null) {
    return false
  }

  try {
    await Shell.killTree(proc.process, { exited: () => proc.process.exitCode !== null })
    return true
  } catch {
    return false
  }
}

const resolveWasm = (asset: string) => {
  if (asset.startsWith("file://")) return fileURLToPath(asset)
  if (asset.startsWith("/") || /^[a-z]:/i.test(asset)) return asset
  const url = new URL(asset, import.meta.url)
  return fileURLToPath(url)
}

const parser = lazy(async () => {
  const { Parser } = await import("web-tree-sitter")
  const { default: treeWasm } = await import("web-tree-sitter/tree-sitter.wasm" as string, {
    with: { type: "wasm" },
  })
  const treePath = resolveWasm(treeWasm)
  await Parser.init({
    locateFile() {
      return treePath
    },
  })
  const { default: bashWasm } = await import("tree-sitter-bash/tree-sitter-bash.wasm" as string, {
    with: { type: "wasm" },
  })
  const bashPath = resolveWasm(bashWasm)
  const bashLanguage = await Language.load(bashPath)
  const p = new Parser()
  p.setLanguage(bashLanguage)
  return p
})

// TODO: we may wanna rename this tool so it works better on other shells
export const BashTool = Tool.define("bash", async () => {
  const shell = Shell.acceptable()
  log.info("bash tool using shell", { shell })

  return {
    description: DESCRIPTION.replaceAll("${directory}", Instance.directory)
      .replaceAll("${maxLines}", String(Truncate.MAX_LINES))
      .replaceAll("${maxBytes}", String(Truncate.MAX_BYTES)),
    parameters: z.object({
      command: z.string().describe("The command to execute"),
      timeout: z.number().describe("Optional timeout in milliseconds").optional(),
      workdir: z
        .string()
        .describe(
          `The working directory to run the command in. Defaults to ${Instance.directory}. Use this instead of 'cd' commands.`,
        )
        .optional(),
      description: z
        .string()
        .describe(
          "Clear, concise description of what this command does in 5-10 words. Examples:\nInput: ls\nOutput: Lists files in current directory\n\nInput: git status\nOutput: Shows working tree status\n\nInput: npm install\nOutput: Installs package dependencies\n\nInput: mkdir foo\nOutput: Creates directory 'foo'",
        ),
    }),
    async execute(params, ctx) {
      const cwd = params.workdir || Instance.directory
      if (params.timeout !== undefined && params.timeout < 0) {
        throw new Error(`Invalid timeout value: ${params.timeout}. Timeout must be a positive number.`)
      }
      const timeout = params.timeout ?? DEFAULT_TIMEOUT
      const tree = await parser().then((p) => p.parse(params.command))
      if (!tree) {
        throw new Error("Failed to parse command")
      }
      const directories = new Set<string>()
      if (!Instance.containsPath(cwd)) directories.add(cwd)
      const patterns = new Set<string>()
      const always = new Set<string>()

      for (const node of tree.rootNode.descendantsOfType("command")) {
        if (!node) continue
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
              .cwd(cwd)
              .quiet()
              .nothrow()
              .text()
              .then((x) => x.trim())
            log.info("resolved path", { arg, resolved })
            if (resolved) {
              // Git Bash on Windows returns Unix-style paths like /c/Users/...
              const normalized =
                process.platform === "win32" && resolved.match(/^\/[a-z]\//)
                  ? resolved.replace(/^\/([a-z])\//, (_, drive) => `${drive.toUpperCase()}:\\`).replace(/\//g, "\\")
                  : resolved
              if (!Instance.containsPath(normalized)) directories.add(normalized)
            }
          }
        }

        // cd covered by above check
        if (command.length && command[0] !== "cd") {
          patterns.add(command.join(" "))
          always.add(BashArity.prefix(command).join(" ") + "*")
        }
      }

      if (directories.size > 0) {
        await ctx.ask({
          permission: "external_directory",
          patterns: Array.from(directories),
          always: Array.from(directories).map((x) => path.dirname(x) + "*"),
          metadata: {},
        })
      }

      if (patterns.size > 0) {
        await ctx.ask({
          permission: "bash",
          patterns: Array.from(patterns),
          always: Array.from(always),
          metadata: {},
        })
      }

      const proc = spawn(params.command, {
        shell,
        cwd,
        env: {
          ...process.env,
        },
        stdio: ["pipe", "pipe", "pipe"], // Changed to pipe stdin for potential input
        detached: process.platform !== "win32",
      })

      let output = ""
      const startTime = Date.now()
      const callID = ctx.callID ?? `bash_${Date.now()}_${Math.random().toString(36).slice(2)}`

      // Metadata object for UI controls
      const metadataObj = {
        output: "",
        description: params.description,
        pid: proc.pid,
        startTime,
        callID,
        running: true,
      }

      // Initialize metadata with process info for UI controls
      // Retry a few times since status might still be "pending" initially
      log.info("bash: initializing foreground process metadata", { callID, pid: proc.pid, startTime })
      let metadataRetries = 0
      const trySetMetadata = async () => {
        await ctx.metadata({ metadata: metadataObj })
        metadataRetries++
      }
      await trySetMetadata()
      // Retry a few more times in case status was "pending"
      const metadataRetryInterval = setInterval(async () => {
        if (metadataRetries < 5) {
          await trySetMetadata()
        } else {
          clearInterval(metadataRetryInterval)
        }
      }, 50)

      const append = (chunk: Buffer) => {
        output += chunk.toString()
        // Stop retry interval once we have output (metadata should be set by now)
        clearInterval(metadataRetryInterval)
        // Update foreground process output if registered
        const fg = foregroundProcesses().get(callID)
        if (fg) {
          fg.output = output
        }
        // Update metadata object and send update
        metadataObj.output = output.length > MAX_METADATA_LENGTH ? output.slice(0, MAX_METADATA_LENGTH) + "\n\n..." : output
        ctx.metadata({ metadata: metadataObj })
      }

      proc.stdout?.on("data", append)
      proc.stderr?.on("data", append)

      let timedOut = false
      let aborted = false
      let exited = false
      let migrated = false
      let migratedTaskId: string | null = null

      const kill = () => Shell.killTree(proc, { exited: () => exited })

      if (ctx.abort.aborted) {
        aborted = true
        await kill()
      }

      const abortHandler = () => {
        aborted = true
        void kill()
      }

      ctx.abort.addEventListener("abort", abortHandler, { once: true })

      const timeoutTimer = setTimeout(() => {
        timedOut = true
        void kill()
      }, timeout + 100)

      // Register this process so it can be migrated to background
      const migrationResult = await new Promise<void | { migrated: true; taskId: string }>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timeoutTimer)
          clearInterval(metadataRetryInterval)
          ctx.abort.removeEventListener("abort", abortHandler)
          foregroundProcesses().delete(callID)
        }

        // Register the foreground process for potential migration
        foregroundProcesses().set(callID, {
          callID,
          sessionID: ctx.sessionID,
          pid: proc.pid!,
          command: params.command,
          description: params.description,
          workdir: cwd,
          startTime,
          process: proc,
          output,
          resolve: (result) => {
            migrated = true
            migratedTaskId = result.taskId
            cleanup()
            resolve(result)
          },
          migrated: false,
        })

        proc.once("exit", () => {
          exited = true
          cleanup()
          resolve()
        })

        proc.once("error", (error) => {
          exited = true
          cleanup()
          reject(error)
        })
      })

      // Handle migration case
      if (migrated && migratedTaskId) {
        const migratedOutput = `Process migrated to background task.\nTask ID: ${migratedTaskId}\nOriginal output (${output.length} bytes) preserved.\n\nUse process_query tool to read output later.`

        return {
          title: params.description,
          metadata: {
            output: migratedOutput,
            description: params.description,
            taskId: migratedTaskId,
            migrated: true,
            running: false,
            exit: null as number | null,
            pid: undefined as number | undefined,
            callID: undefined as string | undefined,
            startTime: undefined as number | undefined,
          },
          output: migratedOutput,
        }
      }

      const resultMetadata: string[] = []

      if (timedOut) {
        resultMetadata.push(`bash tool terminated command after exceeding timeout ${timeout} ms`)
      }

      if (aborted) {
        resultMetadata.push("User aborted the command")
      }

      if (resultMetadata.length > 0) {
        output += "\n\n<bash_metadata>\n" + resultMetadata.join("\n") + "\n</bash_metadata>"
      }

      return {
        title: params.description,
        metadata: {
          output: output.length > MAX_METADATA_LENGTH ? output.slice(0, MAX_METADATA_LENGTH) + "\n\n..." : output,
          exit: proc.exitCode,
          description: params.description,
          running: false,
          taskId: undefined as string | undefined,
          migrated: false,
          pid: undefined as number | undefined,
          callID: undefined as string | undefined,
          startTime: undefined as number | undefined,
        },
        output,
      }
    },
  }
})
