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
import { Truncate } from "./truncate"
import { Plugin } from "@/plugin"
import { SandboxSpawn } from "@/sandbox/spawn"

const MAX_METADATA_LENGTH = 30_000
const DEFAULT_TIMEOUT = Flag.OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS || 2 * 60 * 1000

export const log = Log.create({ service: "bash-tool" })

function args(shell: string, command: string) {
  const name = (process.platform === "win32" ? path.win32.basename(shell, ".exe") : path.basename(shell)).toLowerCase()
  if (name === "zsh") return ["-f", "-c", command]
  if (name === "bash") return ["--noprofile", "--norc", "-c", command]
  return ["-c", command]
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
      const cfg = await SandboxSpawn.settings()
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

        const blocked = SandboxSpawn.excluded(command, cfg.excluded_commands)
        if (blocked) {
          throw new SandboxSpawn.CommandError(blocked.command, blocked.rule)
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
      const root = Instance.worktree === "/" ? Instance.directory : Instance.worktree
      const sandbox = await SandboxSpawn.resolve(
        {
          cwd,
          project_root: Instance.directory,
          worktree_root: root,
        },
        cfg,
      )
      const base = {
        file: shell,
        args: args(shell, params.command),
      }
      const cmd =
        sandbox.active && sandbox.profile
          ? SandboxSpawn.wrap({
              profile: sandbox.profile,
              file: base.file,
              args: base.args,
            })
          : { file: params.command, args: [] as string[] }
      const env = {
        ...process.env,
        ...shellEnv.env,
      }

      // Initialize metadata with empty output
      ctx.metadata({
        metadata: {
          output: "",
          description: params.description,
        },
      })

      const run = async (input?: { file: string; args: string[] }) => {
        const proc = input
          ? spawn(input.file, input.args, {
              cwd,
              env,
              stdio: ["ignore", "pipe", "pipe"],
              detached: process.platform !== "win32",
              windowsHide: process.platform === "win32",
            })
          : spawn(params.command, {
              shell,
              cwd,
              env,
              stdio: ["ignore", "pipe", "pipe"],
              detached: process.platform !== "win32",
              windowsHide: process.platform === "win32",
            })

        let output = ""
        let stderr = ""
        let timedOut = false
        let aborted = false
        let exited = false
        let code = 0

        const append = (chunk: Buffer) => {
          output += chunk.toString()
          ctx.metadata({
            metadata: {
              output: output.length > MAX_METADATA_LENGTH ? output.slice(0, MAX_METADATA_LENGTH) + "\n\n..." : output,
              description: params.description,
            },
          })
        }

        proc.stdout?.on("data", append)
        proc.stderr?.on("data", (chunk) => {
          stderr += chunk.toString()
          append(chunk)
        })

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

          proc.once("exit", (value) => {
            code = value ?? 1
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

        return {
          output,
          stderr,
          timedOut,
          aborted,
          code,
        }
      }

      let retried = false
      let result = await run(sandbox.active ? cmd : undefined)

      if (
        cfg.allow_unsandboxed_retry &&
        !result.timedOut &&
        !result.aborted &&
        SandboxSpawn.shouldRetry({ active: sandbox.active, code: result.code, stderr: result.stderr })
      ) {
        try {
          await ctx.ask({
            permission: "bash:unsandboxed",
            patterns: [params.command],
            always: [params.command],
            metadata: {
              reason: "sandbox_denial",
            },
          })
          retried = true
          ctx.metadata({
            metadata: {
              output: "",
              description: params.description,
            },
          })
          result = await run(SandboxSpawn.unwrap(cmd))
        } catch (error) {
          log.info("unsandboxed retry rejected", { error })
        }
      }

      const notes: string[] = []

      if (retried) {
        notes.push("Retried command without sandbox after sandbox denial")
      }

      if (result.timedOut) {
        notes.push(`bash tool terminated command after exceeding timeout ${timeout} ms`)
      }

      if (result.aborted) {
        notes.push("User aborted the command")
      }

      if (notes.length > 0) {
        result.output += "\n\n<bash_metadata>\n" + notes.join("\n") + "\n</bash_metadata>"
      }

      return {
        title: params.description,
        metadata: {
          output:
            result.output.length > MAX_METADATA_LENGTH
              ? result.output.slice(0, MAX_METADATA_LENGTH) + "\n\n..."
              : result.output,
          exit: result.code,
          description: params.description,
        },
        output: result.output,
      }
    },
  }
})
