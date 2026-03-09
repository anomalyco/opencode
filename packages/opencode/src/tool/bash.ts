import z from "zod"
import { spawn } from "child_process"
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
import { Shell } from "@/shell/shell"

import { BashArity } from "@/permission/arity"
import { Truncate } from "./truncation"
import { Plugin } from "@/plugin"

const MAX_METADATA_LENGTH = 30_000
const DEFAULT_TIMEOUT = Flag.OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS || 2 * 60 * 1000

export const log = Log.create({ service: "bash-tool" })

// Registry for active bash processes — enables server-level watchdog
const active = new Map<
  string,
  {
    pid: number
    timeout: number
    started: number
    kill: () => void
    done: () => void
  }
>()

export function stale() {
  const result: string[] = []
  const now = Date.now()
  for (const [id, entry] of active) {
    if (now - entry.started > entry.timeout + 5000) result.push(id)
  }
  return result
}

export function reap(id: string) {
  const entry = active.get(id)
  if (!entry) return
  log.info("reaping stuck process", {
    callID: id,
    pid: entry.pid,
    age: Date.now() - entry.started,
  })
  entry.kill()
  entry.done()
  active.delete(id)
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

      const shellEnv = await Plugin.trigger(
        "shell.env",
        { cwd, sessionID: ctx.sessionID, callID: ctx.callID },
        { env: {} },
      )
      const proc = spawn(params.command, {
        shell,
        cwd,
        env: {
          ...process.env,
          ...shellEnv.env,
        },
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
      })

      if (!proc.pid) {
        if (proc.exitCode !== null) {
          log.info("process exited before pid could be read", { exitCode: proc.exitCode })
        } else {
          throw new Error(`Failed to spawn process: pid is undefined for command "${params.command}"`)
        }
      }

      log.info("spawned process", {
        pid: proc.pid,
        command: params.command.slice(0, 100),
        cwd,
        timeout,
      })

      const MAX_OUTPUT_BYTES = 10 * 1024 * 1024 // 10 MB cap
      const outputChunks: Buffer[] = []
      let outputLen = 0

      // Initialize metadata with empty output
      ctx.metadata({
        metadata: {
          output: "",
          description: params.description,
        },
      })

      const append = (chunk: Buffer) => {
        outputChunks.push(chunk)
        outputLen += chunk.length
        // Evict oldest chunks if we exceed the cap
        while (outputLen > MAX_OUTPUT_BYTES && outputChunks.length > 1) {
          const removed = outputChunks.shift()!
          outputLen -= removed.length
        }
        const preview = Buffer.concat(outputChunks).toString()
        ctx.metadata({
          metadata: {
            // truncate the metadata to avoid GIANT blobs of data (has nothing to do w/ what agent can access)
            output: preview.length > MAX_METADATA_LENGTH ? preview.slice(0, MAX_METADATA_LENGTH) + "\n\n..." : preview,
            description: params.description,
          },
        })
      }

      proc.stdout?.on("data", append)
      proc.stderr?.on("data", append)

      let timedOut = false
      let aborted = false
      let exited = false

      const kill = () => Shell.killTree(proc, { exited: () => exited })

      if (ctx.abort.aborted) {
        aborted = true
        await kill()
      }

      const abortHandler = () => {
        log.info("process abort triggered", { pid: proc.pid })
        aborted = true
        void kill()
      }

      ctx.abort.addEventListener("abort", abortHandler, { once: true })

      const timeoutTimer = setTimeout(() => {
        log.info("process timeout triggered", { pid: proc.pid, timeout })
        timedOut = true
        void kill()
      }, timeout + 100)

      const started = Date.now()

      const callID = ctx.callID
      if (callID) {
        active.set(callID, {
          pid: proc.pid!,
          timeout,
          started,
          kill: () => Shell.killTree(proc, { exited: () => exited }),
          done: () => {},
        })
      }

      await new Promise<void>((resolve, reject) => {
        let resolved = false

        const cleanup = () => {
          if (resolved) return
          resolved = true
          clearTimeout(timeoutTimer)
          clearInterval(poll)
          ctx.abort.removeEventListener("abort", abortHandler)
          proc.stdout?.removeListener("end", check)
          proc.stderr?.removeListener("end", check)
        }

        const done = () => {
          if (resolved) return
          exited = true
          cleanup()
          resolve()
        }

        // Update the active entry with the real done callback
        if (callID) {
          const entry = active.get(callID)
          if (entry) entry.done = done
        }

        const fail = (error: Error) => {
          if (resolved) return
          exited = true
          cleanup()
          reject(error)
        }

        proc.once("exit", () => {
          log.info("process exit detected via 'exit' event", { pid: proc.pid, exitCode: proc.exitCode })
          done()
        })
        proc.once("close", () => {
          log.info("process exit detected via 'close' event", { pid: proc.pid, exitCode: proc.exitCode })
          done()
        })
        proc.once("error", fail)

        // Redundancy: stdio end events fire when pipe file descriptors close
        // independent of process exit monitoring — catches missed exit events
        let streams = 0
        const total = (proc.stdout ? 1 : 0) + (proc.stderr ? 1 : 0)
        const check = () => {
          streams++
          if (streams < total) return
          if (proc.exitCode !== null || proc.signalCode !== null) {
            log.info("stdio end detected exit (exitCode already set)", {
              pid: proc.pid,
              exitCode: proc.exitCode,
            })
            done()
            return
          }
          setTimeout(() => {
            log.info("stdio end deferred check", {
              pid: proc.pid,
              exitCode: proc.exitCode,
            })
            done()
          }, 50)
        }
        proc.stdout?.once("end", check)
        proc.stderr?.once("end", check)

        // Polling watchdog: detect process exit when Bun's event loop
        // fails to deliver the "exit" event (confirmed Bun bug in containers)
        const poll = setInterval(() => {
          if (proc.exitCode !== null || proc.signalCode !== null) {
            log.info("polling watchdog detected exit via exitCode/signalCode", {
              exitCode: proc.exitCode,
              signalCode: proc.signalCode,
            })
            done()
            return
          }

          // Check 2: process.kill(pid, 0) throws ESRCH if process is dead
          if (proc.pid && process.platform !== "win32") {
            try {
              process.kill(proc.pid, 0)
            } catch {
              log.info("polling watchdog detected exit via kill(0) ESRCH", {
                pid: proc.pid,
              })
              done()
              return
            }
          }
        }, 1000)
      })

      if (callID) active.delete(callID)

      log.info("process completed", {
        pid: proc.pid,
        exitCode: proc.exitCode,
        duration: Date.now() - started,
        timedOut,
        aborted,
      })

      let output = Buffer.concat(outputChunks).toString()
      // Free the chunks array
      outputChunks.length = 0
      outputLen = 0

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
        },
        output,
      }
    },
  }
})
