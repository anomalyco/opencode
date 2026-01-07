import z from "zod"
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
import { buildGitEnv } from "./git-env"

import { BashArity } from "@/permission/arity"

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

// Shell built-ins that require shell wrapper
const SHELL_BUILTINS = new Set([
  // Bash built-ins
  "echo", "pwd", "ls", "cd", "type", "which", "where",
  "ver", "time", "set", "chcp", "exit", "history", "alias",
  "bg", "bind", "break", "builtin", "caller", "case", "command",
  "compgen", "complete", "continue", "declare", "dirs", "disown",
  "do", "done", "elif", "else", "esac", "eval", "exec", "export",
  "fc", "fg", "fi", "for", "function", "getopts", "hash", "help",
  "if", "in", "jobs", "kill", "let", "local", "logout", "mapfile",
  "popd", "pushd", "read", "readarray", "readonly", "return",
  "select", "shift", "suspend", "test", "then", "times", "trap",
  "true", "typeset", "ulimit", "umask", "unalias", "unset", "until",
  "wait", "while",
  // Windows-specific patterns
  "%[^%]+%",  // Environment variable expansion
])

// Commands that look like shell built-ins (start with special characters)
const SHELL_PATTERN = /^%\\w+%|\\$\\w+|\\\\$\\{\\w+\\}/

function needsShellExecution(command: string): boolean {
  // Extract first word (handle quotes)
  const firstWord = command.trim().match(/^([\"']?)(\\S+)\\1/)?.[2]?.toLowerCase() ?? ""

  // Check if it's a known shell built-in
  if (SHELL_BUILTINS.has(firstWord)) {
    return true
  }

  // Check if command contains shell-specific syntax
  if (SHELL_PATTERN.test(command)) {
    return true
  }

  // Check for shell operators
  if (/[;&|]/.test(command) && !command.startsWith("git") && !command.startsWith("npm")) {
    return true
  }

  return false
}

function resolveWindowsCommand(command: string, shell: string): { cmd: string[]; useShell: boolean } {
  const trimmed = command.trim()
  const shellName = path.basename(shell).toLowerCase()

  // Use appropriate flag for different shells
  const flag = shellName.includes('cmd') ? '/c' : '-c'
  return { cmd: [shell, flag, trimmed], useShell: true }
}

/**
 * Detects the shell type from a command string
 * Returns: 'powershell' | 'pwsh' | 'cmd' | 'bash' | 'other'
 */
export function detectCommandShell(command: string): 'powershell' | 'pwsh' | 'cmd' | 'bash' | 'other' {
  const trimmed = command.trim().toLowerCase()

  // PowerShell detection
  if (trimmed.startsWith('powershell.exe') || trimmed.startsWith('powershell') || trimmed.startsWith('pwsh')) {
    return trimmed.startsWith('pwsh') ? 'pwsh' : 'powershell'
  }

  // CMD detection
  if (trimmed.startsWith('cmd.exe') || trimmed.startsWith('cmd ')) {
    return 'cmd'
  }

  // Bash detection
  if (trimmed.startsWith('bash') || trimmed.startsWith('sh') || trimmed.startsWith('/bin/bash') || trimmed.startsWith('/bin/sh')) {
    return 'bash'
  }

  return 'other'
}

/**
 * Parses command to extract executable and arguments
 * Returns: { executable: string, args: string[], shouldBypassShell: boolean }
 */
export function parseCommand(command: string): { executable: string; args: string[]; shouldBypassShell: boolean } {
  const trimmed = command.trim()
  const shellType = detectCommandShell(trimmed)

  // PowerShell commands: MUST use shell wrapper for proper argument parsing
  // Issue #27 fix: PowerShell -Command "..." requires cmd.exe to parse correctly
  // Without shell wrapping, arguments are split incorrectly and commands fail
  if (shellType === 'powershell' || shellType === 'pwsh') {
    const parts = trimmed.split(/\s+/)
    const executable = shellType === 'pwsh' ? 'pwsh' : 'powershell.exe'
    const args = parts.slice(1)

    return {
      executable,
      args,
      shouldBypassShell: false // Use shell wrapper for proper parsing
    }
  }

  // CMD commands: extract cmd.exe and arguments
  if (shellType === 'cmd') {
    const parts = trimmed.split(/\s+/)
    if (parts.length > 0 && (parts[0] === 'cmd.exe' || parts[0] === 'cmd')) {
      return {
        executable: parts[0],
        args: parts.slice(1),
        shouldBypassShell: true // Direct execution, no shell wrapping
      }
    }
  }

  return {
    executable: command, // Use entire command as executable
    args: [],
    shouldBypassShell: false // Use default shell wrapping
  }
}

// TODO: we may wanna rename this tool so it works better on other shells
export const BashTool = Tool.define("bash", async () => {
  // Temporarily force cmd.exe on Windows for testing
  const shell = process.platform === "win32" ? "cmd.exe" : Shell.acceptable()
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
      const directories = new Set<string>()
      if (!Filesystem.contains(Instance.directory, cwd)) directories.add(cwd)
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
              if (!Filesystem.contains(Instance.directory, normalized)) directories.add(normalized)
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

      // Resolve command for Windows compatibility
      // Use parseCommand to detect native Windows commands and bypass shell wrapping
      const parsed = parseCommand(params.command)
      let cmd: string[]
      let shellConfig: string | undefined

      if (parsed.shouldBypassShell && process.platform === "win32") {
        // Direct execution for PowerShell and CMD commands
        log.info("Direct execution detected", {
          command: params.command,
          executable: parsed.executable,
          args: parsed.args
        })
        cmd = [parsed.executable, ...parsed.args]
        shellConfig = undefined // No shell wrapper
      } else {
        // Use shell wrapper for other commands
        const { cmd: shellCmd, useShell } = resolveWindowsCommand(params.command, shell)
        cmd = shellCmd
        shellConfig = useShell ? undefined : shell
      }

      const proc = Bun.spawn(cmd, {
        shell: shellConfig,
        cwd,
        env: buildGitEnv(),
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

      const append = (chunk: Buffer | Uint8Array | string) => {
        const text = chunk instanceof Buffer || chunk instanceof Uint8Array
          ? new TextDecoder().decode(chunk)
          : chunk
        if (output.length <= MAX_OUTPUT_LENGTH) {
          output += text
          ctx.metadata({
            metadata: {
              output,
              description: params.description,
            },
          })
        }
      }

      // Stream reader approach for cross-platform compatibility
      const stdoutReader = proc.stdout?.getReader()
      const stderrReader = proc.stderr?.getReader()

      const readOutput = async (reader: ReadableStreamDefaultReader | undefined): Promise<void> => {
        if (!reader) return
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            append(value)
          }
        } catch {
          // Stream reading ended (abort or natural completion)
        }
      }

      let timedOut = false
      let aborted = false
      let exited = false

      const kill = () => Shell.killTree(proc, { exited: () => exited })

      // Handle abort before starting
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

      // Start reading streams
      const stdoutPromise = readOutput(stdoutReader)
      const stderrPromise = readOutput(stderrReader)

      // Wait for process exit
      await proc.exited

      // Guarantee streams drain before returning (Issue #17 fix)
      // This prevents data loss when proc.exited resolves before streams finish
      await Promise.all([stdoutPromise, stderrPromise]).catch(() => {})

      exited = true

      // Cleanup
      clearTimeout(timeoutTimer)
      ctx.abort.removeEventListener("abort", abortHandler)

      let resultMetadata: String[] = ["<bash_metadata>"]

      if (output.length > MAX_OUTPUT_LENGTH) {
        output = output.slice(0, MAX_OUTPUT_LENGTH)
        resultMetadata.push(`bash tool truncated output as it exceeded ${MAX_OUTPUT_LENGTH} char limit`)
      }

      if (timedOut) {
        resultMetadata.push(`bash tool terminated command after exceeding timeout ${timeout} ms`)
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
