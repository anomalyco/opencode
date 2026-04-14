import { Buffer } from "buffer"
import z from "zod"
import { appendFile } from "fs/promises"
import fs from "fs/promises"
import { spawn } from "child_process"
import { Tool } from "./tool"
import path from "path"
import DESCRIPTION from "./bash.txt"
import { Identifier } from "../id/id"
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

import { Log } from "../util/log"

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
          "Clear, concise description of what this command does in 5-10 words. Examples:\nInput: ls\nOutput: Lists files in current directory\n\nInput: git status\nOutput: Shows working directory status\n\nInput: npm install\nOutput: Installs package dependencies\n\nInput: mkdir foo\nOutput: Creates directory 'foo'",
        ),
    }),
    formatValidationError(error: any): string {
      const issues = error?.issues ?? error?.errors ?? []
      return issues.map((e: any) => `${e.path?.join(".") ?? "input"}: ${e.message}`).join("\n")
    },
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

      // Use Buffer for accumulation. When exceeding WINDOW_SIZE,
      // switch to file streaming to avoid O(n²) memory growth.
      const tmpId = Identifier.ascending("tool")
      const tmpPath = path.join(Truncate.DIR, tmpId)
      await fs.mkdir(Truncate.DIR, { recursive: true })
      const WINDOW_SIZE = 50 * 1024
      let output: Buffer | null = null
      let outputSize = 0
      let lineCount = 0
      let truncated = false
      let writer: ReturnType<Bun.BunFile["writer"]> | null = null

      const proc = spawn(params.command, {
        shell,
        cwd,
        env: {
          ...process.env,
        },
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
      })

      ctx.metadata({
        metadata: {
          output: "",
          description: params.description,
        },
      })

      const append = (chunk: Buffer) => {
        const str = chunk.toString()
        outputSize += str.length
        lineCount += (str.match(/\n/g) || []).length

        if (lineCount > Truncate.MAX_LINES || outputSize > WINDOW_SIZE) {
          truncated = true
          if (!writer) {
            const tmpFile = Bun.file(tmpPath)
            writer = tmpFile.writer()
            if (output) {
              writer.write(output)
            }
          }
          writer.write(chunk)
        } else {
          if (output) {
            output = Buffer.concat([output, chunk])
          } else {
            output = chunk
          }
        }

        if (output) {
          const preview = output.toString()
          ctx.metadata({
            metadata: {
              output: preview,
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

      const cleanupFile = async () => {
        if (!truncated) return
        try {
          await fs.unlink(tmpPath)
        } catch {}
      }

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

      try {
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
      } catch (err) {
        await cleanupFile()
        throw err
      }

      if (truncated) {
        await writer!.flush()
      }

      const resultMetadata: string[] = []

      if (timedOut) {
        resultMetadata.push(`bash tool terminated command after exceeding timeout ${timeout} ms`)
      }

      if (aborted) {
        resultMetadata.push("User aborted the command")
      }

      if (truncated) {
        if (resultMetadata.length > 0) {
          const metadataText = "\n\n<bash_metadata>\n" + resultMetadata.join("\n") + "\n</bash_metadata>"
          await appendFile(tmpPath, metadataText)
        }

        const userPreview = output ? (output as Buffer).toString() : ""
        const agentPreview = `${userPreview}\n\n...${outputSize - WINDOW_SIZE} bytes truncated...\n\nThe tool call succeeded but the output was truncated. Full output saved to: ${tmpPath}\nGrep to search the full content or Read with offset/limit to view specific sections.\nIf Task tool is available, delegate that to an explore agent.`

        return {
          title: params.description,
          metadata: {
            output: userPreview,
            truncated,
            exit: proc.exitCode,
            description: params.description,
            outputPath: tmpPath,
          },
          output: agentPreview,
        }
      }

      if (resultMetadata.length > 0) {
        const metadataText = "\n\n<bash_metadata>\n" + resultMetadata.join("\n") + "\n</bash_metadata>"
        if (output) {
          output = Buffer.concat([output, Buffer.from(metadataText)])
        } else {
          output = Buffer.from(metadataText)
        }
      }

      const outputStr = output ? (output as Buffer).toString() : ""

      return {
        title: params.description,
        metadata: {
          output: outputStr,
          truncated,
          exit: proc.exitCode,
          description: params.description,
          outputPath: "",
        },
        output: outputStr,
      }
    },
  }
})
