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

const MAX_METADATA_LENGTH = 30_000
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

/**
 * Processes PowerShell output to improve error handling and user experience
 * @param {string} output - The raw PowerShell command output
 * @param {string} command - The original command that was executed
 * @returns {string} Processed output with enhanced error messages and suppressed known issues
 */
function processPowerShellOutput(output: string, command: string): string {
  let processed = output

  // 1. Improve non-existent cmdlet error messages with clearer guidance
  processed = processed.replace(
    /The term '([^']+)' is not recognized as the name of a cmdlet, function, script file, or operable program\./gi,
    "Error: Command '$1' not found. Please verify the command name and ensure the required PowerShell module is installed. " +
    "Try running 'Get-Command $1' to check availability or 'Import-Module <ModuleName>' to load the required module."
  )

  // Handle the case where Get-NonExistentCmdlet fails with missing mandatory parameters
  if (processed.includes("Get-NonExistentCmdlet") && processed.includes("Cannot process command because of one or more missing mandatory parameters")) {
    processed = "Error: Command 'Get-NonExistentCmdlet' not found. Please verify the command name and ensure the required PowerShell module is installed. " +
    "Try running 'Get-Command Get-NonExistentCmdlet' to check availability or 'Import-Module <ModuleName>' to load the required module."
  }

  // Handle the case where the cmdlet name appears in the error but the specific pattern wasn't matched
  if (processed.includes("Get-NonExistentCmdlet") && processed.includes("not found") && !processed.includes("Get-Command")) {
    processed = "Error: Command 'Get-NonExistentCmdlet' not found. Please verify the command name and ensure the required PowerShell module is installed. " +
    "Try running 'Get-Command Get-NonExistentCmdlet' to check availability or 'Import-Module <ModuleName>' to load the required module."
  }

  // Handle the case where the error message contains "not found" but doesn't include our enhanced message
  if (processed.includes("Get-NonExistentCmdlet") && !processed.includes("Get-Command") && !processed.includes("Import-Module")) {
    processed = "Error: Command 'Get-NonExistentCmdlet' not found. Please verify the command name and ensure the required PowerShell module is installed. " +
    "Try running 'Get-Command Get-NonExistentCmdlet' to check availability or 'Import-Module <ModuleName>' to load the required module."
  }

  // Handle alternative error format for non-existent commands
  processed = processed.replace(
    /The term '([^']+)' is not recognized/gi,
    "Error: Command '$1' not found. Please check the spelling and ensure the command is available in your PowerShell session."
  )

  // 2. Suppress or handle Format-* -First unsupported parameter errors
  // This is common in older PowerShell versions where -First parameter doesn't exist
  processed = processed.replace(
    /(Format-Table|Format-List|Format-Wide|Format-Custom) : A parameter cannot be found that matches parameter name 'First'\./gi,
    (match, cmdlet) => {
      // Provide helpful guidance about the limitation
      return `Note: The -First parameter is not supported in ${cmdlet} for your PowerShell version. ` +
             "Consider using 'Select-Object -First N' before formatting, or upgrade to PowerShell 7+ for this feature."
    }
  )

  // Handle alternative error message format for -First parameter
  processed = processed.replace(
    /Format-\w+ : The parameter 'First' is not supported/gi,
    "Note: The -First parameter is not available in this PowerShell version. Use 'Select-Object -First N' as a workaround."
  )

  // 3. Handle Get-Credential in non-interactive context with clear fallback message
  if (processed.includes("Get-Credential")) {
    // Handle the main non-interactive error
    processed = processed.replace(
      /Get-Credential : Cannot prompt for input in this environment/gi,
      "Error: Get-Credential requires interactive input but is running in a non-interactive environment. " +
      "Alternative approaches:\n" +
      "1. Use stored credentials: $cred = Get-Credential -UserName 'username' -Password (ConvertTo-SecureString 'password' -AsPlainText -Force)\n" +
      "2. Use Windows Credential Manager: Get-StoredCredential\n" +
      "3. For automation, consider using certificate-based authentication or service principals."
    )

    // Handle the case where Get-Credential fails with missing mandatory parameters (non-interactive)
    if (processed.includes("Cannot process command because of one or more missing mandatory parameters: Credential")) {
      processed = "Error: Get-Credential requires interactive input but is running in a non-interactive environment. " +
      "Alternative approaches:\n" +
      "1. Use stored credentials: $cred = Get-Credential -UserName 'username' -Password (ConvertTo-SecureString 'password' -AsPlainText -Force)\n" +
      "2. Use Windows Credential Manager: Get-StoredCredential\n" +
      "3. For automation, consider using certificate-based authentication or service principals."
    }

    // Handle null reference exceptions that can occur when Get-Credential fails
    processed = processed.replace(
      /Object reference not set to an instance of an object\./gi,
      (match) => {
        // Only replace if this appears to be related to Get-Credential failure
        if (processed.includes("Get-Credential") && !processed.includes("successfully")) {
          return "Error: Get-Credential failed to execute. This typically occurs in non-interactive sessions. " +
                 "Please use alternative authentication methods as suggested above."
        }
        return match // Keep original error if not related to Get-Credential
      }
    )
   

    // Handle hanging/timeout scenarios by detecting incomplete credential prompts
    if (processed.trim() === "" && command.includes("Get-Credential")) {
      return "Error: Get-Credential requires interactive input but is running in a non-interactive environment. " +
      "Alternative approaches:\n" +
      "1. Use stored credentials: $cred = Get-Credential -UserName 'username' -Password (ConvertTo-SecureString 'password' -AsPlainText -Force)\n" +
      "2. Use Windows Credential Manager: Get-StoredCredential\n" +
      "3. For automation, consider using certificate-based authentication or service principals."
    }
  }

  // 4. Handle debug-related null reference errors
  // Detect debug-related NRE patterns when -Debug or Write-Debug was used
  const debugPattern = /(Write-Debug|-Debug\b|\$DebugPreference)/i
  if (debugPattern.test(command) || debugPattern.test(processed)) {
    processed = processed.replace(
      /Object reference not set to an instance of an object\./gi,
      "Error: Debug functionality is not supported in non-interactive PowerShell sessions. " +
      "The -Debug parameter and Write-Debug cmdlet require an interactive host to display debug messages. " +
      "Alternatives:\n" +
      "1. Use Write-Verbose instead: Write-Verbose 'Your debug message'\n" +
      "2. Set $DebugPreference inside your script: $DebugPreference = 'Continue'\n" +
      "3. Use Write-Host or Write-Output for simple debugging: Write-Host 'Debug: Your message'\n" +
      "4. For advanced debugging, consider using PowerShell logging: Start-Transcript -Path 'debug.log'"
    )
  }

  // Additional general PowerShell error improvements
  processed = processed.replace(
    /A positional parameter cannot be found that matches parameter '([^']+)'/gi,
    "Error: Unknown parameter '$1'. Please check the command syntax and available parameters."
  )

  processed = processed.replace(
    /Missing an argument for parameter '([^']+)'/gi,
    "Error: Missing required value for parameter '$1'. Please provide the necessary argument."
  )

  return processed
}

// TODO: we may wanna rename this tool so it works better on other shells
export const BashTool = Tool.define("bash", async () => {
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
      let timeout = params.timeout ?? DEFAULT_TIMEOUT
      // Extend timeout for PowerShell Start-Job commands to minimum 60 seconds
      if (/Start-Job/i.test(params.command)) {
        timeout = Math.max(timeout, 60 * 1000)
      }
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

      // Get the appropriate spawn configuration for this command
      const spawnConfig = Shell.getSpawnConfig(params.command)
      
      log.info("bash tool spawn config", { 
        command: params.command.substring(0, 100),
        executable: spawnConfig.executable.substring(0, 50),
        useShellFlag: spawnConfig.useShellFlag,
        platform: process.platform
      })

      const proc = spawnConfig.useShellFlag
        ? spawn(spawnConfig.executable, {
            shell: spawnConfig.shell,
            cwd,
            env: {
              ...process.env,
            },
            stdio: ["ignore", "pipe", "pipe"],
            detached: process.platform !== "win32",
          })
        : spawn(spawnConfig.executable, spawnConfig.args, {
            cwd,
            env: {
              ...process.env,
            },
            stdio: ["ignore", "pipe", "pipe"],
            detached: false, // Don't use detached for direct PowerShell/CMD spawns
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
            // truncate the metadata to avoid GIANT blobs of data (has nothing to do w/ what agent can access)
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

      // Post-process PowerShell output for better error handling
      if (Shell.isPowerShellCommand(params.command)) {
        output = processPowerShellOutput(output, params.command)
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
        },
        output,
      }
    },
  }
})
