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

const MAX_METADATA_LENGTH = 30_000
const DEFAULT_TIMEOUT = Flag.OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS || 2 * 60 * 1000

function executorUrl() {
  const url = process.env.VERITLY_EXECUTOR_URL?.trim()
  if (url) return url
  throw new Error("Missing required env var: VERITLY_EXECUTOR_URL")
}

// Executor configuration
const MAX_RETRIES = 3
const RETRY_DELAY_MS = 1000

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

// Execute command on executor with retry logic
async function executeOnExecutor(
  sessionId: string,
  command: string,
  timeout: number,
  retryCount = 0,
): Promise<{ output: string; exitCode: number; vmId?: string }> {
  const url = executorUrl()
  try {
    const response = await fetch(`${url}/v1/sessions/${sessionId}/exec`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command, timeout }),
    })

    if (response.status === 404) {
      // VM not found - session mapping exists but VM was cleaned up
      // This can happen if VM was inactive for too long
      sessionToExecutor.delete(sessionId)

      if (retryCount < MAX_RETRIES) {
        log.info("VM not found, will retry with new VM", { sessionId, retryCount })
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
        return executeOnExecutor(sessionId, command, timeout, retryCount + 1)
      }

      return {
        output: "Error: VM session expired and could not be recreated. Please try again.",
        exitCode: 1,
      }
    }

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Executor error: ${response.status} - ${error}`)
    }

    const result = await response.json()
    sessionToExecutor.set(sessionId, true)

    return {
      output: result.output,
      exitCode: result.exitCode,
      vmId: result.vmId,
    }
  } catch (error: any) {
    if (error.message?.includes("fetch") || error.code === "ECONNREFUSED") {
      // Executor is not available
      log.error("Executor unavailable", { error: error.message, sessionId })
      return {
        output: `Error: Executor service unavailable at ${url}. Please ensure the executor is running.`,
        exitCode: 1,
      }
    }
    throw error
  }
}

// Check executor health
async function checkExecutorHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${executorUrl()}/health`, { timeout: 5000 } as any)
    return response.ok
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
      const tracer = trace.getTracer("veritly-session")
      return tracer.startActiveSpan("bash.execute", async (span) => {
        const t0 = Date.now()
        const hash = createHash("sha256").update(params.command).digest("hex").slice(0, 16)
        span.setAttribute("veritly.tool.name", "bash")
        span.setAttribute("veritly.tool.command_sha256_prefix", hash)

        try {
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
          if (params.workdir && params.workdir !== Instance.directory) {
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

          if (result.vmId) {
            resultMetadata.push(`vm: ${result.vmId.slice(0, 8)}`)
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
