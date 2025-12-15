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
import { Shell } from "@/shell/shell"

const MAX_OUTPUT_LENGTH = Flag.OPENCODE_EXPERIMENTAL_BASH_MAX_OUTPUT_LENGTH || 30_000
const DEFAULT_TIMEOUT = Flag.OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS || 2 * 60 * 1000

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
  const shell = Shell.acceptable()
  log.info("bash tool using shell", { shell })

  return {
    description: DESCRIPTION.replaceAll("${directory}", Instance.directory),
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
      const agent = await Agent.get(ctx.agent)

      const checkExternalDirectory = async (dir: string) => {
        if (Filesystem.contains(Instance.directory, dir)) return
        const title = `This command references paths outside of ${Instance.directory}`
        if (agent.permission.external_directory === "ask") {
          await Permission.ask({
            type: "external_directory",
            pattern: [dir, path.join(dir, "*")],
            sessionID: ctx.sessionID,
            messageID: ctx.messageID,
            callID: ctx.callID,
            title,
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
            `${title} so this command is not allowed to be executed.`,
          )
        }
      }

      await checkExternalDirectory(cwd)

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

              await checkExternalDirectory(normalized)
            }
          }
        }

        // always allow cd if it passes above check
        if (command[0] !== "cd") {
          const action = Wildcard.allStructured({ head: command[0], tail: command.slice(1) }, permissions)
          if (action === "deny") {
            throw new Error(
              `The user has specifically restricted access to this command: "${command.join(" ")}", you are not allowed to execute it. The user has these settings configured: ${JSON.stringify(permissions)}`,
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
        cwd,
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
        if (output.length <= MAX_OUTPUT_LENGTH) {
          output += chunk.toString()
          ctx.metadata({
            metadata: {
              output,
              description: params.description,
            },
          })
        }
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
        aborted = true
        void kill()
      }

      ctx.abort.addEventListener("abort", abortHandler, { once: true })

      const timeoutTimer = setTimeout(() => {
        timedOut = true
        void kill()
      }, timeout + 100)

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

      let resultMetadata: String[] = ["<bash_metadata>"]

      if (output.length > MAX_OUTPUT_LENGTH) {
        output = output.slice(0, MAX_OUTPUT_LENGTH)
        resultMetadata.push(`bash tool truncated output as it exceeded ${MAX_OUTPUT_LENGTH} char limit`)
      }

      if (timedOut) {
        resultMetadata.push(`bash tool terminated commmand after exceeding timeout ${timeout} ms`)
      }

      if (aborted) {
        resultMetadata.push("User aborted the command")
      }

      if (resultMetadata.length > 1) {
        resultMetadata.push("</bash_metadata>")
        output += "\n\n" + resultMetadata.join("\n")
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
