import z from "zod"
import { createHash } from "node:crypto"
import { trace, SpanStatusCode } from "@opentelemetry/api"
import { Tool } from "./tool"
import path from "path"
import DESCRIPTION from "./bash.txt"
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { lazy } from "@/util/lazy"
import { Language } from "web-tree-sitter"
import fs from "fs/promises"

import { Filesystem } from "@/util/filesystem"
import { fileURLToPath } from "url"
import { Flag } from "@/flag/flag.ts"

import { BashArity } from "@/permission/arity"
import { Truncate } from "./truncation"
import { Plugin } from "@/plugin"
import { Session } from "@/session"
import { Executor } from "@/executor/sdk"

const MAX_METADATA_LENGTH = 30_000
const DEFAULT_TIMEOUT = Flag.OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS || 2 * 60 * 1000

// Lazy initialization of typed executor SDK
let executor: ReturnType<typeof Executor.create> | null = null
function getExecutor() {
  if (!executor) {
    const url = process.env.VERITLY_EXECUTOR_URL?.trim()
    if (!url) throw new Error("Missing required env var: VERITLY_EXECUTOR_URL")
    executor = Executor.create({ baseUrl: url })
  }
  return executor
}

export const log = Log.create({ service: "bash-tool" })

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

// Track which session is connected to which executor VM
const sessionToExecutor = new Map<string, boolean>()

// Execute command on executor using typed SDK
async function executeOnExecutor(
  sessionId: string,
  command: string,
  timeout: number,
): Promise<{ output: string; exitCode: number }> {
  try {
    const result = await getExecutor().exec(sessionId, command, timeout)
    sessionToExecutor.set(sessionId, true)
    return {
      output: result.output,
      exitCode: result.exitCode,
    }
  } catch (error: any) {
    if (error.code === "SESSION_NOT_FOUND") {
      // VM was cleaned up - session will be auto-created on next exec
      sessionToExecutor.delete(sessionId)
      return {
        output: "Error: VM session expired. Please try again.",
        exitCode: 1,
      }
    }
    
    if (error.code === "EXECUTION_FAILED" || error.code === "HEALTH_CHECK_FAILED") {
      // Executor is not available
      log.error("Executor unavailable", { error: error.message, sessionId })
      return {
        output: `Error: Executor service unavailable. Please ensure the executor is running.`,
        exitCode: 1,
      }
    }
    
    throw error
  }
}

// Check executor health using typed SDK
async function checkExecutorHealth(): Promise<boolean> {
  try {
    return await getExecutor().isAvailable()
  } catch {
    return false
  }
}

// TODO: we may wanna rename this tool so it works better on other shells
export const BashTool = Tool.define("bash", async () => {
  const executorHealthy = await checkExecutorHealth()
  if (!executorHealthy) {
    log.warn("Executor is not healthy, bash commands will fail", { executorUrl: process.env.VERITLY_EXECUTOR_URL })
  }

  return {
    description: DESCRIPTION.replaceAll("${workspace}", Instance.workspace)
      .replaceAll("${maxLines}", String(Truncate.MAX_LINES))
      .replaceAll("${maxBytes}", String(Truncate.MAX_BYTES)),
    parameters: z.object({
      command: z.string().describe("The command to execute"),
      timeout: z.number().describe("Optional timeout in milliseconds").optional(),
      workdir: z
        .string()
        .describe(
          `The working directory to run the command in. Defaults to ${Instance.workspace}. Use this instead of 'cd' commands.`,
        )
        .optional(),
      description: z
        .string()
        .describe(
          "Clear, concise description of what this command does in 5-10 words. Examples:\nInput: ls\nOutput: Lists files in current directory\n\nInput: git status\nOutput: Shows working tree status\n\nInput: npm install\nOutput: Installs package dependencies\n\nInput: mkdir foo\nOutput: Creates directory 'foo'",
        ),
    }),
    async execute(params, ctx) {
      const tracer = trace.getTracer("veritly-session")
      return tracer.startActiveSpan("bash.execute", async (span) => {
        const t0 = Date.now()
        const hash = createHash("sha256").update(params.command).digest("hex").slice(0, 16)
        span.setAttribute("veritly.tool.name", "bash")
        span.setAttribute("veritly.tool.command_sha256_prefix", hash)

        try {
          const cwd = params.workdir || Instance.workspace
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

            // Get full command text including redirects if present
            let commandText = node.parent?.type === "redirected_statement" ? node.parent.text : node.text

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
            if (["cd", "rm", "cp", "mv", "mkdir", "touch", "chmod", "chown", "cat"].includes(command[0])) {
              for (const arg of command.slice(1)) {
                if (arg.startsWith("-") || (command[0] === "chmod" && arg.startsWith("+"))) continue
                const resolved = await fs.realpath(path.resolve(cwd, arg)).catch(() => "")
                log.info("resolved path", { arg, resolved })
                if (resolved) {
                  const normalized =
                    process.platform === "win32" ? Filesystem.windowsPath(resolved).replace(/\//g, "\\") : resolved
                  if (!Instance.containsPath(normalized)) {
                    const dir = (await Filesystem.isDir(normalized)) ? normalized : path.dirname(normalized)
                    directories.add(dir)
                  }
                }
              }
            }

            // cd covered by above check
            if (command.length && command[0] !== "cd") {
              patterns.add(commandText)
              always.add(BashArity.prefix(command).join(" ") + " *")
            }
          }

          if (directories.size > 0) {
            const globs = Array.from(directories).map((dir) => {
              // Preserve POSIX-looking paths with /s, even on Windows
              if (dir.startsWith("/")) return `${dir.replace(/[\\/]+$/, "")}/*`
              return path.join(dir, "*")
            })
            await ctx.ask({
              permission: "external_directory",
              patterns: globs,
              always: globs,
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

          // Prepare command with workdir if specified
          let finalCommand = params.command
          if (params.workdir && params.workdir !== Instance.workspace) {
            finalCommand = `cd ${params.workdir} && ${params.command}`
          }

          // Execute via executor
          const sessionId = ctx.sessionID
          const result = await executeOnExecutor(sessionId, finalCommand, timeout)

          let output = result.output

          // Add metadata
          const resultMetadata: string[] = []
          if (result.exitCode === 124) {
            resultMetadata.push(`bash tool terminated command after exceeding timeout ${timeout} ms`)
          }

          if (resultMetadata.length > 0) {
            output += "\n\n<bash_metadata>\n" + resultMetadata.join("\n") + "\n</bash_metadata>"
          }

          span.setAttribute("process.exit_code", result.exitCode)
          return {
            title: params.description,
            metadata: {
              output: output.length > MAX_METADATA_LENGTH ? output.slice(0, MAX_METADATA_LENGTH) + "\n\n..." : output,
              exit: result.exitCode,
              description: params.description,
            },
            output,
          }
        } catch (e) {
          span.recordException(e as Error)
          span.setStatus({ code: SpanStatusCode.ERROR })
          throw e
        } finally {
          span.setAttribute("veritly.tool.duration_ms", Date.now() - t0)
        }
      })
    },
  }
})
