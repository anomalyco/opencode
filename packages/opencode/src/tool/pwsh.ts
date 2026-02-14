import z from "zod"
import { spawn } from "child_process"
import { Tool } from "./tool"
import path from "path"
import fs from "fs"
import os from "os"
import DESCRIPTION from "./pwsh.txt"
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { lazy } from "@/util/lazy"
import { Language } from "web-tree-sitter"

import { Filesystem } from "@/util/filesystem"
import { fileURLToPath } from "url"
import { Shell } from "@/shell/shell"

import { PwshArity } from "@/permission/pwsh-arity"
import { Truncate } from "./truncation"
import { Plugin } from "@/plugin"
import * as PwshWindows from "./pwsh-windows"

const MAX_METADATA_LENGTH = 30_000
const DEFAULT_TIMEOUT = 2 * 60 * 1000

export const log = Log.create({ service: "pwsh-tool" })

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
  const { default: pwshWasm } = await import("tree-sitter-powershell/tree-sitter-powershell.wasm" as string, {
    with: { type: "wasm" },
  })
  const pwshPath = resolveWasm(pwshWasm)
  const pwshLanguage = await Language.load(pwshPath)
  const p = new Parser()
  p.setLanguage(pwshLanguage)
  return p
})

// Filesystem cmdlets and their common aliases (matched case-insensitively)
const FILESYSTEM_CMDLETS = new Set([
  // Full cmdlet names
  "set-location",
  "remove-item",
  "copy-item",
  "move-item",
  "new-item",
  "set-content",
  "get-content",
  "get-childitem",
  "add-content",
  "clear-content",
  "out-file",
  "rename-item",
  "test-path",
  "invoke-item",
  // Common aliases
  "cd",
  "sl",
  "chdir",
  "rm",
  "ri",
  "del",
  "erase",
  "rd",
  "rmdir",
  "cp",
  "cpi",
  "copy",
  "mv",
  "mi",
  "move",
  "mkdir",
  "ni",
  "sc",
  "gc",
  "cat",
  "type",
  "gci",
  "ls",
  "dir",
  "ac",
  "clc",
  "ren",
  "rni",
  "ii",
])

// Named parameters that contain filesystem paths (matched case-insensitively)
const PATH_PARAMETERS = new Set(["-path", "-literalpath", "-destination", "-newname", "-source", "-filepath"])

// Dangerous cmdlets that should always require explicit permission (never auto-approved)
// These can execute code, access network, modify system state, or access sensitive resources
const DANGEROUS_CMDLETS = new Set([
  // Code execution
  "invoke-expression",
  "invoke-command",
  "start-process",
  "start-job",
  "iex", // alias for Invoke-Expression
  "icm", // alias for Invoke-Command
  "saps", // alias for Start-Process
  "sajb", // alias for Start-Job

  // Network access
  "invoke-webrequest",
  "invoke-restmethod",
  "test-connection",
  "test-netconnection",
  "new-netfirewallrule",
  "iwr", // alias for Invoke-WebRequest
  "irm", // alias for Invoke-RestMethod
  "curl", // alias for Invoke-WebRequest
  "wget", // alias for Invoke-WebRequest

  // Registry access
  "new-itemproperty",
  "set-itemproperty",
  "remove-itemproperty",
  "get-itemproperty",
  "get-item", // can access registry paths like HKCU:\
  "sp", // alias for Set-ItemProperty
  "gp", // alias for Get-ItemProperty
  "gi", // alias for Get-Item

  // System modification
  "stop-process",
  "stop-service",
  "start-service",
  "restart-service",
  "restart-computer",
  "stop-computer",
  "spps", // alias for Stop-Process
  "spsv", // alias for Stop-Service
  "sasv", // alias for Start-Service
  "rsv", // alias for Restart-Service

  // Credential and sensitive data
  "get-credential",
  "convertto-securestring",
  "convertfrom-securestring",
  "export-clixml",
  "import-clixml",
  "export-csv",
  "epcsv", // alias for Export-Csv
  "ipcsv", // alias for Import-Csv
])

// Set-Location and its aliases — excluded from command permission patterns (same as cd in bash)
const SET_LOCATION_NAMES = new Set(["set-location", "cd", "sl", "chdir"])

// Checks if a value looks like a PowerShell variable/expression that cannot be resolved statically
// Also detects PowerShell provider paths which are not filesystem paths
function isUnresolvable(value: string): boolean {
  // PowerShell variables and expressions - but allow specific resolvable ones
  if (value.startsWith("$")) {
    // Allow $HOME and $HOME/path (we expand them in resolvePathArg)
    const upperValue = value.toUpperCase()
    const isHome = upperValue === "$HOME" || upperValue.startsWith("$HOME/") || upperValue.startsWith("$HOME\\")
    if (!isHome) {
      // Block all other variables ($env:, $PSScriptRoot, etc.)
      return true
    }
  }

  if (value.startsWith("(") || value.startsWith("@(")) return true

  // PowerShell provider paths (not filesystem paths, should be blocked or specially handled)
  // Common providers: Cert:, HKCU:, HKLM:, Env:, Function:, Variable:, Alias:, WSMan:
  if (/^[A-Za-z]+:\\/.test(value)) {
    const providerMatch = value.match(/^([A-Za-z]+):\\/)
    if (providerMatch) {
      const provider = providerMatch[1].toLowerCase()
      // Allow only C: through Z: (filesystem drive letters)
      // Block all other providers (Cert, HKCU, HKLM, Env, Function, Variable, Alias, WSMan, etc.)
      if (provider.length !== 1) {
        log.warn("Blocking PowerShell provider path", { path: value, provider })
        return true // Treat as unresolvable to prevent bypassing external_directory check
      }
    }
  }

  return false
}

// Strip surrounding quotes from a string value
function stripQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }
  return value
}

/**
 * Normalize MSYS/Cygwin-style paths to Windows paths on Windows.
 * /c/foo -> C:/foo, /cygdrive/c/foo -> C:/foo
 * Leaves regular relative paths and non-MSYS paths unchanged.
 */
function normalizeMsysPath(p: string): string {
  if (process.platform !== "win32") return p
  // /cygdrive/X/... -> X:/...
  const cygMatch = p.match(/^\/cygdrive\/([a-zA-Z])(\/.*)?$/)
  if (cygMatch) return `${cygMatch[1].toUpperCase()}:${cygMatch[2] || "/"}`
  // /X/... -> X:/... (single letter after leading slash)
  const msysMatch = p.match(/^\/([a-zA-Z])(\/.*)?$/)
  if (msysMatch) return `${msysMatch[1].toUpperCase()}:${msysMatch[2] || "/"}`
  return p
}

// Resolve a path argument to its real filesystem path, returning null if unresolvable
function resolvePathArg(cwd: string, arg: string): string | null {
  if (arg.startsWith("-")) return null
  const stripped = stripQuotes(arg)
  if (isUnresolvable(stripped)) return null
  try {
    // Expand ~ to home directory (PowerShell resolves ~ to $HOME)
    let expanded = stripped
    if (expanded === "~") {
      expanded = os.homedir()
    } else if (expanded.startsWith("~/") || expanded.startsWith("~\\")) {
      expanded = os.homedir() + expanded.slice(1)
    }

    // Expand $HOME (case-insensitive, matching isUnresolvable which also uses toUpperCase)
    const upper = expanded.toUpperCase()
    if (upper === "$HOME") {
      expanded = os.homedir()
    } else if (upper.startsWith("$HOME/") || upper.startsWith("$HOME\\")) {
      expanded = os.homedir() + expanded.slice(5)
    }

    const normalized = normalizeMsysPath(expanded)
    const resolved = path.resolve(cwd, normalized)
    try {
      return fs.realpathSync(resolved)
    } catch {
      // Path doesn't exist yet — resolve nearest existing ancestor
      let current = resolved
      while (true) {
        const parent = path.dirname(current)
        if (parent === current) return null // reached root without finding existing dir
        try {
          return fs.realpathSync(parent)
        } catch {
          current = parent
        }
      }
    }
  } catch {
    return null
  }
}

// Extract parameter value handling -Param value, -Param:value, and -Param=value forms
function extractParamValue(paramText: string): { name: string; inlineValue: string | null } {
  const colonIdx = paramText.indexOf(":")
  if (colonIdx > 0) {
    return { name: paramText.slice(0, colonIdx).toLowerCase(), inlineValue: paramText.slice(colonIdx + 1) }
  }
  const eqIdx = paramText.indexOf("=")
  if (eqIdx > 0) {
    return { name: paramText.slice(0, eqIdx).toLowerCase(), inlineValue: paramText.slice(eqIdx + 1) }
  }
  return { name: paramText.toLowerCase(), inlineValue: null }
}

export const PwshTool = Tool.define("pwsh", async () => {
  const pwshPath = Shell.pwsh()
  if (!pwshPath) throw new Error("pwsh not found")

  log.info("pwsh tool using shell", { pwshPath })

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
          `The working directory to run the command in. Defaults to ${Instance.directory}. Use this instead of 'Set-Location' commands.`,
        )
        .optional(),
      description: z
        .string()
        .describe(
          "Clear, concise description of what this command does in 5-10 words. Examples:\nInput: Get-ChildItem\nOutput: Lists files in current directory\n\nInput: git status\nOutput: Shows working tree status\n\nInput: dotnet build\nOutput: Builds .NET project\n\nInput: New-Item -ItemType Directory foo\nOutput: Creates directory 'foo'",
        ),
    }),
    async execute(params, ctx) {
      const cwd = params.workdir || Instance.directory
      if (params.timeout !== undefined && params.timeout < 0) {
        throw new Error(`Invalid timeout value: ${params.timeout}. Timeout must be a positive number.`)
      }
      const timeout = params.timeout ?? DEFAULT_TIMEOUT

      const directories = new Set<string>()
      if (!Instance.containsPath(cwd)) directories.add(cwd)
      const patterns = new Set<string>()
      const always = new Set<string>()
      // Windows security checks accumulate ASK-level decisions here.
      // BLOCK decisions throw immediately; ASK decisions force the command
      // through the permission prompt without auto-approval.
      let windowsAsk: string | undefined

      // Windows-specific security checks: bypass techniques and cmd.exe patterns
      // run against raw command text before tree-sitter parsing.
      if (process.platform === "win32") {
        const decision = PwshWindows.evaluate(params.command)
        if (decision.action === "block") {
          throw new Error(`Command blocked: ${decision.reason}`)
        }
        if (decision.action === "ask") {
          windowsAsk = decision.reason
        }
      }

      // Parse command with tree-sitter-powershell
      let parseFailed = false
      let foundCommands = false
      try {
        const tree = await parser().then((p) => p.parse(params.command))
        if (!tree) {
          parseFailed = true
        } else {
          // tree-sitter-powershell uses "command" nodes for command invocations
          const commandNodes = tree.rootNode.descendantsOfType("command")

          for (const node of commandNodes) {
            if (!node) continue

            // Extract command name from direct command_name child (not descendants,
            // to avoid picking up names from nested command nodes inside script blocks)
            const nameNode = node.children.find((c) => c?.type === "command_name")
            const name = nameNode?.text
            if (!name) continue
            foundCommands = true

            const nameLower = name.toLowerCase()

            // Build tokens for arity analysis and collect path arguments
            const tokens: string[] = [name]
            const pathArgs: string[] = []

            // In tree-sitter-powershell, arguments live inside a command_elements child node.
            // Iterate command_elements children to find parameters and arguments.
            const elementsNode = node.children.find((c) => c?.type === "command_elements")
            if (elementsNode) {
              for (let i = 0; i < elementsNode.childCount; i++) {
                const child = elementsNode.child(i)
                if (!child) continue

                // Skip whitespace separators
                if (child.type === "command_argument_sep") continue

                if (child.type === "command_parameter") {
                  const { name: paramName, inlineValue } = extractParamValue(child.text)

                  if (PATH_PARAMETERS.has(paramName)) {
                    if (inlineValue) {
                      pathArgs.push(stripQuotes(inlineValue))
                    } else {
                      // Value is the next non-separator sibling
                      let nextIdx = i + 1
                      // Skip over separator nodes
                      while (nextIdx < elementsNode.childCount) {
                        const peek = elementsNode.child(nextIdx)
                        if (peek && peek.type !== "command_argument_sep") break
                        nextIdx++
                      }
                      const nextSibling = elementsNode.child(nextIdx)
                      if (nextSibling && nextSibling.type !== "command_parameter") {
                        pathArgs.push(stripQuotes(nextSibling.text))
                        i = nextIdx // skip to the value node
                      }
                    }
                  }
                  continue
                }

                // generic_token: unquoted argument values (paths, subcommands, etc.)
                if (child.type === "generic_token") {
                  tokens.push(child.text)
                  if (FILESYSTEM_CMDLETS.has(nameLower)) {
                    pathArgs.push(stripQuotes(child.text))
                  }
                  continue
                }

                // Quoted strings may be wrapped: array_literal_expression > unary_expression > string_literal > expandable_string_literal
                // Use the outermost text which includes quotes, then strip them
                if (
                  child.type === "string_literal" ||
                  child.type === "expandable_string_literal" ||
                  child.type === "array_literal_expression"
                ) {
                  tokens.push(child.text)
                  if (FILESYSTEM_CMDLETS.has(nameLower)) {
                    pathArgs.push(stripQuotes(child.text))
                  }
                  continue
                }
              }
            }

            // Windows-specific per-cmdlet checks (registry/provider paths)
            // Always run even if windowsAsk is set — a BLOCK here must override ASK.
            if (process.platform === "win32") {
              const allArgs = [...pathArgs, ...tokens.slice(1)]
              const decision = PwshWindows.registry(name, allArgs)
              if (decision.action === "block") {
                throw new Error(`Command blocked: ${decision.reason}`)
              }
              if (decision.action === "ask" && !windowsAsk) {
                windowsAsk = decision.reason
              }
            }

            // Get full command text including redirections
            const commandText = node.parent?.type === "redirected_statement" ? node.parent.text : node.text

            // Resolve paths for external_directory check
            if (FILESYSTEM_CMDLETS.has(nameLower)) {
              for (const arg of pathArgs) {
                const resolved = resolvePathArg(cwd, arg)
                if (resolved && !Instance.containsPath(resolved)) {
                  const dir = (await Filesystem.isDir(resolved)) ? resolved : path.dirname(resolved)
                  directories.add(dir)
                }
              }
            }

            // Build permission patterns — exclude Set-Location/cd (handled by external_directory)
            // Also exclude dangerous cmdlets from auto-approval (always require explicit permission)
            if (tokens.length && !SET_LOCATION_NAMES.has(nameLower)) {
              patterns.add(commandText)
              // Only add to 'always' (auto-approve) if NOT a dangerous cmdlet
              // and no Windows security check flagged this command for ASK
              if (!DANGEROUS_CMDLETS.has(nameLower) && !windowsAsk) {
                always.add(PwshArity.prefix(tokens).join(" ") + " *")
              }
            }
          }
        }
      } catch (e) {
        log.warn("tree-sitter parse failed, falling back to raw permission", { error: e })
        parseFailed = true
      }

      // External directory permission
      if (directories.size > 0) {
        const globs = Array.from(directories).map((dir) => path.join(dir, "*"))
        await ctx.ask({
          permission: "external_directory",
          patterns: globs,
          always: globs,
          metadata: {},
        })
      }

      // Command permission
      if (patterns.size > 0) {
        await ctx.ask({
          permission: "pwsh",
          patterns: Array.from(patterns),
          // If a Windows security check flagged ASK, strip auto-approval
          always: windowsAsk ? [] : Array.from(always),
          metadata: windowsAsk ? { warning: windowsAsk } : {},
        })
      } else if (parseFailed || !foundCommands) {
        // Parse failed or no command nodes found — fall back to raw command permission
        await ctx.ask({
          permission: "pwsh",
          patterns: [params.command],
          always: windowsAsk ? [] : [params.command],
          metadata: windowsAsk ? { warning: windowsAsk } : {},
        })
      }

      const shellEnv = await Plugin.trigger("shell.env", { cwd }, { env: {} })
      const proc = spawn(pwshPath, ["-NoProfile", "-NonInteractive", "-Command", params.command], {
        cwd,
        env: {
          ...process.env,
          ...shellEnv.env,
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
            output: output.length > MAX_METADATA_LENGTH ? output.slice(0, MAX_METADATA_LENGTH) + "\n\n..." : output,
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

      const resultMetadata: string[] = []

      if (timedOut) {
        resultMetadata.push(`pwsh tool terminated command after exceeding timeout ${timeout} ms`)
      }

      if (aborted) {
        resultMetadata.push("User aborted the command")
      }

      if (resultMetadata.length > 0) {
        output += "\n\n<pwsh_metadata>\n" + resultMetadata.join("\n") + "\n</pwsh_metadata>"
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
