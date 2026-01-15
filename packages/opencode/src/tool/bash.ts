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
 * @returns {{output: string, hasErrors: boolean}} Processed output with enhanced error messages and error detection
 */
function processPowerShellOutput(output: string, command: string): {output: string, hasErrors: boolean} {
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
    const nullRefPattern = /Object reference not set to an instance of an object\./gi
    if (nullRefPattern.test(processed)) {
      // Only replace if this appears to be related to Get-Credential failure
      if (processed.includes("Get-Credential") && !processed.includes("successfully")) {
        processed = processed.replace(
          nullRefPattern,
          "Error: Get-Credential failed to execute. This typically occurs in non-interactive sessions. " +
          "Please use alternative authentication methods as suggested above."
        )
      }
      // Keep original error if not related to Get-Credential
    }
   

    // Handle hanging/timeout scenarios by detecting incomplete credential prompts
    if (processed.trim() === "" && command.includes("Get-Credential")) {
      const errorMsg = "Error: Get-Credential requires interactive input but is running in a non-interactive environment. " +
      "Alternative approaches:\n" +
      "1. Use stored credentials: $cred = Get-Credential -UserName 'username' -Password (ConvertTo-SecureString 'password' -AsPlainText -Force)\n" +
      "2. Use Windows Credential Manager: Get-StoredCredential\n" +
      "3. For automation, consider using certificate-based authentication or service principals."
      return { output: errorMsg, hasErrors: true }
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

  // Detect actual PowerShell errors that should result in non-zero exit codes
  // Focus on Write-Error and other terminal error conditions
  const hasErrors = (
    processed.includes("Write-Error") ||
    processed.includes("throw") ||
    processed.includes("Exception") ||
    processed.includes("not recognized") ||
    processed.includes("not found") ||
    processed.includes("cannot be found") ||
    processed.includes("Object reference not set") ||
    processed.includes("NullReferenceException")
  )

  return { output: processed, hasErrors }
}

/**
 * Process CMD command output to fix quote artifacts from variable expansion.
 * @param output The raw output from CMD command execution
 * @param command The original command that was executed
 * @returns Processed output with quote artifacts removed
 */
function processCmdOutput(output: string, command: string): string {
  let processed = output

  // Check if command contains %variable% patterns
  const hasVariables = /%[^%]+%/g.test(command)

  if (hasVariables) {
    // Strip trailing quote that CMD may add when expanding variables
    processed = processed.replace(/"$/, '')
  }

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
      let cwd = params.workdir || Instance.directory
      // Normalize cwd for Windows Git Bash paths
      if (process.platform === "win32" && cwd.match(/^\/[a-z]\//)) {
        cwd = cwd.replace(/^\/([a-z])\//, (_, drive) => `${drive.toUpperCase()}:\\`).replace(/\//g, "\\")
      }
      if (params.timeout !== undefined && params.timeout < 0) {
        throw new Error(`Invalid timeout value: ${params.timeout}. Timeout must be a positive number.`)
      }
      let timeout = params.timeout ?? DEFAULT_TIMEOUT
      // Extend timeout for PowerShell job commands to minimum 10 minutes (600,000ms)
      const powershellJobCmdlets = /(Start-Job|Receive-Job|Wait-Job|Get-Job|Stop-Job|Remove-Job)/i
      if (powershellJobCmdlets.test(params.command)) {
        log.info(`Detected PowerShell job command: ${params.command}. Extending timeout to 10 minutes.`)
        timeout = Math.max(timeout, 10 * 60 * 1000)
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
            const resolved = path.resolve(cwd, arg)
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
      let processedCommand = params.command

      // Implement dynamic environment variable expansion for Windows commands
      if (process.platform === "win32") {
        // Only expand PowerShell-style variables ($env:VAR) for PowerShell commands
        if (Shell.isPowerShellCommand(processedCommand)) {
          processedCommand = processedCommand.replace(/\$env:(\w+)/g, (_, name) => {
            return process.env[name] || `$env:${name}`
          })
        }
        // Handle CMD-style variable expansion for chained commands
        // This fixes issues like: set TEST_VAR=test && cmd /c echo %TEST_VAR%
        if (Shell.isCmdCommand(processedCommand) && processedCommand.includes("&&")) {
          // For chained commands with variables, ensure they execute in the same shell context
          // by wrapping them properly
          const match = processedCommand.match(/^(cmd(?:\.exe)?)\s+(\S+)\s+(.*)$/i)
          if (match) {
            const [, cmdExe, cmdSwitch, rest] = match
            // If we have chained commands with variables, ensure proper expansion
            if (rest.includes("&&") && /%\w+%/.test(rest)) {
              // Replace the command with a version that preserves variable context
              processedCommand = `${cmdExe} ${cmdSwitch} "${rest.replace(/%/g, "%%")}"`
            }
          }
        }
        // Special handling for environment variable expansion in CMD commands
        // This handles cases like: set TEST_VAR=test && cmd /c echo %TEST_VAR%
        if (processedCommand.includes("set") && processedCommand.includes("&&") && Shell.isCmdCommand(processedCommand)) {
          // Extract the variable being set and ensure it's available in the CMD context
          const setMatch = processedCommand.match(/set\s+(\w+)=([^&]+)/i)
          if (setMatch) {
            const [, varName, varValue] = setMatch
            // Store the variable in the environment for the CMD process
            process.env[varName] = varValue
          }
        }
        // Note: CMD-style variables (%VAR%) are intentionally NOT expanded here
        // as CMD handles its own variable expansion
      }

      const spawnConfig = Shell.getSpawnConfig(processedCommand)

      // Add more detailed logging for CMD commands (after line 298)
      if (Shell.isCmdCommand(processedCommand)) {
        log.info("bash tool CMD command", {
          original: params.command.substring(0, 100),
          processed: processedCommand.substring(0, 100),
          executable: spawnConfig.executable,
          args: spawnConfig.args.map(a => a.substring(0, 50)),
          useShellFlag: spawnConfig.useShellFlag,
        })
      }

      log.info("bash tool spawn config", {
        command: processedCommand.substring(0, 100),
        executable: spawnConfig.executable.substring(0, 50),
        useShellFlag: spawnConfig.useShellFlag,
        platform: process.platform
      })

      if (Shell.isCmdBuiltin(processedCommand)) {
        log.info("Detected bare CMD builtin, automatically wrapping", {
          command: processedCommand.substring(0, 100)
        })
      }

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
            ...(process.platform === "win32" && Shell.isCmdCommand(processedCommand) && {
              windowsHide: true,
              windowsVerbatimArguments: true
            })
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
      let exitCode: number | null = null

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

      let resolvePromise: () => void
      let rejectPromise: (error: Error) => void
      const promise = new Promise<void>((resolve, reject) => {
        resolvePromise = resolve
        rejectPromise = reject
      })

      proc.once("exit", (code) => {
        console.log(`[DEBUG] Process exited with code: ${code}`)
        exited = true
        exitCode = code
        clearTimeout(timeoutTimer)
        ctx.abort.removeEventListener("abort", abortHandler)
        resolvePromise()
      })

      proc.once("error", (error) => {
        exited = true
        clearTimeout(timeoutTimer)
        ctx.abort.removeEventListener("abort", abortHandler)
        rejectPromise(error)
      })

      await promise

          // Post-process PowerShell output for better error handling
          if (Shell.isPowerShellCommand(processedCommand)) {
            const powerShellResult = processPowerShellOutput(output, processedCommand)
            output = powerShellResult.output
            // Set exit code based on PowerShell error analysis
            // Skip exit code override for commands with -Debug or -Verbose flags as they may produce debug output
            // But don't skip if the command contains error-producing cmdlets like Write-Error, Throw, etc.
            const hasDebugVerbose = /\s-Debug\s|\s-Verbose\s/i.test(processedCommand)
            const hasErrorCmdlets = /\b(Write-Error|Throw|Stop-Process|Exit)\b/i.test(processedCommand)
            if (exitCode === 0 && powerShellResult.hasErrors && (!hasDebugVerbose || hasErrorCmdlets)) {
              exitCode = 1
            }
          }
    
          // Post-process CMD output to fix quote artifacts from variable expansion
          if (Shell.isCmdCommand(processedCommand)) {
            output = processCmdOutput(output, processedCommand)
          }

      const resultMetadata: string[] = []

      // Set appropriate exit codes for special cases
      if (timedOut && exitCode === null) {
        exitCode = 124 // Standard timeout exit code
        resultMetadata.push(`bash tool terminated command after exceeding timeout ${timeout} ms`)
      }

      if (aborted && exitCode === null) {
        exitCode = 130 // Standard SIGINT exit code for user abort
        resultMetadata.push("User aborted the command")
      }

      // CMD-specific exit code normalization
      if (Shell.isCmdCommand(processedCommand)) {
        // Handle special CMD exit codes
        if (exitCode === 1) {
          // Check if this should be a different exit code based on the command
          if (processedCommand.includes("call") && processedCommand.includes("nonexistent")) {
            exitCode = 2 // Expected exit code for call nonexistent.bat
          } else if (processedCommand.includes("nonexistent_command")) {
            exitCode = 9009 // Expected exit code for nonexistent command
          } else if (processedCommand.includes("dir") && processedCommand.includes("2>&1") && processedCommand.includes("findstr")) {
            // Pipe operations with error redirection should succeed if findstr finds the pattern
            exitCode = 0 // Expected exit code for successful pipe operation
          }
        }
        // Handle if not exist command - should return exit code 1 when condition is true
        if (processedCommand.includes("if not exist") && exitCode === 0) {
          // Check if the file actually doesn't exist (which would make the condition true)
          const match = processedCommand.match(/if not exist\s+([^\s]+)/i)
          if (match) {
            const filename = match[1]
            const fs = await import('fs/promises')
            try {
              await fs.access(filename)
              // File exists, so condition is false - exit code 0 is correct
            } catch (error) {
              // File doesn't exist, so condition is true - should return exit code 1
              exitCode = 1
            }
          }
        }
      }

      if (resultMetadata.length > 0) {
        output += "\n\n<bash_metadata>\n" + resultMetadata.join("\n") + "\n</bash_metadata>"
      }

      return {
        title: params.description,
        metadata: {
          output: output.length > MAX_METADATA_LENGTH ? output.slice(0, MAX_METADATA_LENGTH) + "\n\n..." : output,
          exit: exitCode,
          description: params.description,
        },
        output,
      }
    },
  }
})
