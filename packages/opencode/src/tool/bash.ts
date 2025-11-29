import z from "zod"
import { spawn } from "child_process"
import { Tool } from "./tool"
import DESCRIPTION from "./bash.txt"
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { lazy } from "@/util/lazy"
import { Language } from "web-tree-sitter"
import { Agent } from "@/agent/agent"
import { $ } from "bun"
import { Filesystem } from "@/util/filesystem"
import { Wildcard } from "@/util/wildcard"
import { Permission } from "@/permission"
import { fileURLToPath } from "url"
import { Flag } from "@/flag/flag.ts"
import path from "path"
import { iife } from "@/util/iife"

const DEFAULT_MAX_OUTPUT_LENGTH = 30_000
const MAX_OUTPUT_LENGTH = (() => {
  const parsed = Number(Flag.OPENCODE_EXPERIMENTAL_BASH_MAX_OUTPUT_LENGTH)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_OUTPUT_LENGTH
})()
const DEFAULT_TIMEOUT = 1 * 60 * 1000
const MAX_TIMEOUT = 10 * 60 * 1000
const SIGKILL_TIMEOUT_MS = 200

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

// TODO: we may wanna rename this tool so it works better on other shells

export const BashTool = Tool.define("bash", async () => {
  const shell = iife(() => {
    const s = process.env.SHELL
    if (s) {
      if (!new Set(["/bin/fish", "/bin/nu", "/usr/bin/fish", "/usr/bin/nu"]).has(s)) {
        return s
      }
    }

    if (process.platform === "darwin") {
      return "/bin/zsh"
    }

    if (process.platform === "win32") {
      // Let Bun / Node pick COMSPEC (usually cmd.exe)
      // or explicitly:
      return process.env.COMSPEC || true
    }

    const bash = Bun.which("bash")
    if (bash) {
      return bash
    }

    return true
  })
  log.info("bash tool using shell", { shell })

  return {
    description: DESCRIPTION,
    parameters: z.object({
      command: z.string().describe("The command to execute"),
      timeout: z.number().describe("Optional timeout in milliseconds").optional(),
      description: z
        .string()
        .describe(
          "Clear, concise description of what this command does in 5-10 words. Examples:\nInput: ls\nOutput: Lists files in current directory\n\nInput: git status\nOutput: Shows working tree status\n\nInput: npm install\nOutput: Installs package dependencies\n\nInput: mkdir foo\nOutput: Creates directory 'foo'",
        ),
    }),
    async execute(params, ctx) {
      if (params.timeout !== undefined && params.timeout < 0) {
        throw new Error(`Invalid timeout value: ${params.timeout}. Timeout must be a positive number.`)
      }
      const timeout = Math.min(params.timeout ?? DEFAULT_TIMEOUT, MAX_TIMEOUT)
      const tree = await parser().then((p) => p.parse(params.command))
      if (!tree) {
        throw new Error("Failed to parse command")
      }
      const agent = await Agent.get(ctx.agent)
      const permissions = agent.permission.bash

      const askPatterns = new Set<string>()
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

              if (!Filesystem.contains(Instance.directory, normalized)) {
                const parentDir = path.dirname(normalized)
                if (agent.permission.external_directory === "ask") {
                  await Permission.ask({
                    type: "external_directory",
                    pattern: [parentDir, path.join(parentDir, "*")],
                    sessionID: ctx.sessionID,
                    messageID: ctx.messageID,
                    callID: ctx.callID,
                    title: `This command references paths outside of ${Instance.directory}`,
                    metadata: {
                      command: params.command,
                    },
                  })
                } else if (agent.permission.external_directory === "deny") {
                  throw new Permission.RejectedError(
                    ctx.sessionID,
                    "external_directory",
                    ctx.callID,
                    {
                      command: params.command,
                    },
                    `This command references paths outside of ${Instance.directory} so it is not allowed to be executed.`,
                  )
                }
              }
            }
          }
        }

        // always allow cd if it passes above check
        if (command[0] !== "cd") {
          const action = Wildcard.allStructured({ head: command[0], tail: command.slice(1) }, permissions)
          if (action === "deny") {
            throw new Error(
              `The user has specifically restricted access to this command, you are not allowed to execute it. Here is the configuration: ${JSON.stringify(permissions)}`,
            )
          }
          if (action === "ask") {
            const pattern = (() => {
              if (command.length === 0) return
              const head = command[0]
              // Find first non-flag argument as subcommand
              const sub = command.slice(1).find((arg) => !arg.startsWith("-"))
              return sub ? `${head} ${sub} *` : `${head} *`
            })()
            if (pattern) {
              askPatterns.add(pattern)
            }
          }
        }
      }

      if (askPatterns.size > 0) {
        const patterns = Array.from(askPatterns)
        await Permission.ask({
          type: "bash",
          pattern: patterns,
          sessionID: ctx.sessionID,
          messageID: ctx.messageID,
          callID: ctx.callID,
          title: params.command,
          metadata: {
            command: params.command,
            patterns,
          },
        })
      }

      const proc = spawn(params.command, {
        shell,
        cwd: Instance.directory,
        env: {
          ...process.env,
        },
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
      })

      let output = ""

      // Initialize metadata with empty output
      ctx.metadata({
        metadata: {
          output: "",
          description: params.description,
        },
      })

      const append = (chunk: Buffer) => {
        output += chunk.toString()
        ctx.metadata({
          metadata: {
            output,
            description: params.description,
          },
        })
      }

      proc.stdout?.on("data", append)
      proc.stderr?.on("data", append)

      let timedOut = false
      let aborted = false
      let exited = false

      const killTree = async () => {
        const pid = proc.pid
        if (!pid || exited) {
          return
        }

        if (process.platform === "win32") {
          await new Promise<void>((resolve) => {
            const killer = spawn("taskkill", ["/pid", String(pid), "/f", "/t"], { stdio: "ignore" })
            killer.once("exit", resolve)
            killer.once("error", resolve)
          })
          return
        }

        try {
          process.kill(-pid, "SIGTERM")
          await Bun.sleep(SIGKILL_TIMEOUT_MS)
          if (!exited) {
            process.kill(-pid, "SIGKILL")
          }
        } catch (_e) {
          proc.kill("SIGTERM")
          await Bun.sleep(SIGKILL_TIMEOUT_MS)
          if (!exited) {
            proc.kill("SIGKILL")
          }
        }
      }

      if (ctx.abort.aborted) {
        aborted = true
        await killTree()
      }

      const abortHandler = () => {
        aborted = true
        void killTree()
      }

      ctx.abort.addEventListener("abort", abortHandler, { once: true })

      const timeoutTimer = setTimeout(() => {
        timedOut = true
        void killTree()
      }, timeout)

      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timeoutTimer)
          ctx.abort.removeEventListener("abort", abortHandler)
        }

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

      if (output.length > MAX_OUTPUT_LENGTH) {
        output = output.slice(0, MAX_OUTPUT_LENGTH)
        output += "\n\n(Output was truncated due to length limit)"
      }

      if (timedOut) {
        output += `\n\n(Command timed out after ${timeout} ms)`
      }

      if (aborted) {
        output += "\n\n(Command was aborted)"
      }

      return {
        title: params.description,
        metadata: {
          output,
          exit: proc.exitCode,
          description: params.description,
        },
        output,
      }
    },
  }
})
