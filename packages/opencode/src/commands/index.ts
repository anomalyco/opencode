import fs from "fs/promises"
import path from "path"
import { Global } from "../global"
import { Log } from "../util/log"
import { App } from "../app/app"
import { z } from "zod"

export namespace Commands {
  const log = Log.create({ service: "commands" })

  export interface CommandFile {
    name: string
    filename: string
    content: string
  }

  export interface BashCommandResult {
    command: string
    stdout: string
    stderr: string
    exitCode: number | null
  }

  export const CustomCommand = z
    .object({
      name: z.string(),
      description: z.string().optional(),
      content: z.string(),
      filePath: z.string(),
      isGlobal: z.boolean(),
    })
    .openapi({
      ref: "CustomCommand",
    })
  export type CustomCommand = z.infer<typeof CustomCommand>

  export const ExecuteCommandRequest = z
    .object({
      arguments: z.string().optional(),
    })
    .openapi({
      ref: "ExecuteCommandRequest",
    })
  export type ExecuteCommandRequest = z.infer<typeof ExecuteCommandRequest>

  export const ExecuteCommandResponse = z
    .object({
      processedContent: z.string(),
      bashResults: z.array(
        z.object({
          command: z.string(),
          stdout: z.string(),
          stderr: z.string(),
          exitCode: z.number(),
        }),
      ),
    })
    .openapi({
      ref: "ExecuteCommandResponse",
    })
  export type ExecuteCommandResponse = z.infer<typeof ExecuteCommandResponse>

  export async function getCommandsDirectory(): Promise<string> {
    return path.join(Global.Path.config, "commands")
  }

  export async function ensureCommandsDirectory(): Promise<void> {
    const commandsDir = await getCommandsDirectory()
    await fs.mkdir(commandsDir, { recursive: true })
  }

  export async function listCommandFiles(): Promise<CommandFile[]> {
    try {
      await ensureCommandsDirectory()
      const commandsDir = await getCommandsDirectory()
      const files = await fs.readdir(commandsDir)

      const commandFiles: CommandFile[] = []

      for (const file of files) {
        if (file.endsWith(".md")) {
          const filePath = path.join(commandsDir, file)
          const content = await fs.readFile(filePath, "utf-8")
          const name = path.basename(file, ".md")

          commandFiles.push({
            name,
            filename: file,
            content,
          })
        }
      }

      log.info(`Found ${commandFiles.length} command files`)
      return commandFiles.sort((a, b) => a.name.localeCompare(b.name))
    } catch (error) {
      log.error("Failed to list command files", { error })
      return []
    }
  }

  export async function getCommandFile(
    name: string,
  ): Promise<CommandFile | null> {
    try {
      const commandsDir = await getCommandsDirectory()
      const filePath = path.join(commandsDir, `${name}.md`)
      const content = await fs.readFile(filePath, "utf-8")

      return {
        name,
        filename: `${name}.md`,
        content,
      }
    } catch (error) {
      log.error(`Failed to read command file: ${name}`, { error })
      return null
    }
  }

  async function executeBashCommand(
    command: string,
  ): Promise<BashCommandResult> {
    const process = Bun.spawn({
      cmd: ["bash", "-c", command],
      cwd: App.info().path.cwd,
      maxBuffer: 30000,
      timeout: 60000,
      stdout: "pipe",
      stderr: "pipe",
    })

    await process.exited
    const stdout = await new Response(process.stdout).text()
    const stderr = await new Response(process.stderr).text()

    return {
      command,
      stdout: stdout || "",
      stderr: stderr || "",
      exitCode: process.exitCode,
    }
  }

  function parseBashCommands(content: string): {
    commands: string[]
    cleanContent: string
  } {
    const lines = content.split("\n")
    const commands: string[] = []
    const cleanLines: string[] = []

    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.startsWith("!")) {
        const command = trimmed.slice(1).trim()
        if (command) {
          commands.push(command)
        }
      } else {
        cleanLines.push(line)
      }
    }

    return {
      commands,
      cleanContent: cleanLines.join("\n"),
    }
  }

  export async function processCommandWithBash(
    commandFile: CommandFile,
  ): Promise<CommandFile> {
    try {
      const { commands, cleanContent } = parseBashCommands(commandFile.content)

      if (commands.length === 0) {
        return commandFile
      }

      log.info(
        `Executing ${commands.length} bash commands for ${commandFile.name}`,
      )

      const results: BashCommandResult[] = []
      for (const command of commands) {
        try {
          const result = await executeBashCommand(command)
          results.push(result)
          log.info(`Executed command: ${command}`, {
            exitCode: result.exitCode,
          })
        } catch (error) {
          log.error(`Failed to execute command: ${command}`, { error })
          results.push({
            command,
            stdout: "",
            stderr: error instanceof Error ? error.message : String(error),
            exitCode: 1,
          })
        }
      }

      let contextSection = "\n\n## Command Context\n\n"
      contextSection +=
        "The following bash commands were executed to gather context:\n\n"

      for (const result of results) {
        contextSection += `### Command: \`${result.command}\`\n\n`
        if (result.exitCode === 0) {
          if (result.stdout.trim()) {
            contextSection += "```\n" + result.stdout.trim() + "\n```\n\n"
          } else {
            contextSection += "*No output*\n\n"
          }
        } else {
          contextSection += `*Command failed with exit code ${result.exitCode}*\n\n`
          if (result.stderr.trim()) {
            contextSection += "```\n" + result.stderr.trim() + "\n```\n\n"
          }
        }
      }

      return {
        ...commandFile,
        content: cleanContent + contextSection,
      }
    } catch (error) {
      log.error(`Failed to process bash commands for ${commandFile.name}`, {
        error,
      })
      return commandFile
    }
  }

  export async function getCommandFileWithBash(
    name: string,
  ): Promise<CommandFile | null> {
    const commandFile = await getCommandFile(name)
    if (!commandFile) return null

    return processCommandWithBash(commandFile)
  }

  export async function createExampleCommandFile(): Promise<void> {
    try {
      await ensureCommandsDirectory()
      const commandsDir = await getCommandsDirectory()
      const examplePath = path.join(commandsDir, "example.md")

      // Check if example already exists
      try {
        await fs.access(examplePath)
        return // File already exists
      } catch {
        // File doesn't exist, create it
      }

      const exampleContent = `# Example Command

This is an example command file. You can create markdown files in the commands directory to define custom commands.

## Usage

When you type \`/example\` in the chat, this content will be sent to the LLM as context.

## Features

- Use markdown formatting
- Include code examples
- Add instructions for the LLM
- Create reusable prompts
- Execute bash commands with \`!\` prefix for context gathering

## Bash Commands

You can include bash commands that will be executed before the command content is sent to the LLM:

!git status
!git branch
!git log --oneline -5

These commands will be executed and their output will be included in the context.

## Example Code

\`\`\`typescript
function example() {
  console.log("This is an example");
}
\`\`\`

You can customize this file or create new ones with different names.
`

      await fs.writeFile(examplePath, exampleContent, "utf-8")
      log.info("Created example command file")
    } catch (error) {
      log.error("Failed to create example command file", { error })
    }
  }

  /**
   * List all available custom commands from both global and project directories
   */
  export async function listCustomCommands(): Promise<CustomCommand[]> {
    const app = App.info()
    const commands: CustomCommand[] = []

    // Get global commands from ~/.config/opencode/commands
    const globalCommandsDir = path.join(app.path.config, "commands")
    const globalCommands = await scanCommandsDirectory(
      globalCommandsDir,
      "",
      true,
    )
    commands.push(...globalCommands)

    // Get project-level commands from $PWD/.opencode/commands
    const projectCommandsDir = path.join(app.path.cwd, ".opencode", "commands")
    const projectCommands = await scanCommandsDirectory(
      projectCommandsDir,
      "",
      false,
    )
    commands.push(...projectCommands)

    // Sort commands alphabetically, with project commands taking precedence
    const commandMap = new Map<string, CustomCommand>()

    // Add global commands first
    globalCommands.forEach((cmd) => commandMap.set(cmd.name, cmd))

    // Add project commands (will override global commands with same name)
    projectCommands.forEach((cmd) => commandMap.set(cmd.name, cmd))

    return Array.from(commandMap.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    )
  }

  /**
   * Get a specific custom command by name
   */
  export async function getCustomCommand(
    commandName: string,
  ): Promise<CustomCommand | null> {
    const commands = await listCustomCommands()
    return commands.find((cmd) => cmd.name === commandName) || null
  }

  /**
   * Execute a custom command with optional arguments
   */
  export async function executeCustomCommand(
    commandName: string,
    args?: string,
  ): Promise<ExecuteCommandResponse> {
    const command = await getCustomCommand(commandName)
    if (!command) {
      throw new Error(`Custom command '${commandName}' not found`)
    }

    log.info("executing custom command", { commandName, args })

    // Replace $ARGUMENTS placeholder with actual arguments
    let content = command.content
    if (args) {
      content = content.replace(/\$ARGUMENTS/g, args)
    }

    // Process bash commands if any exist
    const { commands: bashCommands, cleanContent } = parseBashCommands(content)
    const bashResults: Array<{
      command: string
      stdout: string
      stderr: string
      exitCode: number
    }> = []

    if (bashCommands.length > 0) {
      log.info("processing bash commands", { count: bashCommands.length })

      let contextSection = "\n\n## Command Context\n\n"
      contextSection +=
        "The following bash commands were executed to gather context:\n\n"

      for (const bashCommand of bashCommands) {
        try {
          const result = await executeBashCommand(bashCommand)
          bashResults.push({
            command: result.command,
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode || 0,
          })

          contextSection += `### Command: \`${bashCommand}\`\n\n`
          if (result.exitCode === 0) {
            if (result.stdout.trim()) {
              contextSection += "```\n"
              contextSection += result.stdout.trim()
              contextSection += "\n```\n\n"
            } else {
              contextSection += "*No output*\n\n"
            }
          } else {
            contextSection += `*Command failed with exit code ${result.exitCode}*\n\n`
            if (result.stderr.trim()) {
              contextSection += "```\n"
              contextSection += result.stderr.trim()
              contextSection += "\n```\n\n"
            }
          }
        } catch (error) {
          log.error("failed to execute bash command", {
            command: bashCommand,
            error,
          })
          const errorResult = {
            command: bashCommand,
            stdout: "",
            stderr: error instanceof Error ? error.message : String(error),
            exitCode: 1,
          }
          bashResults.push(errorResult)

          contextSection += `### Command: \`${bashCommand}\`\n\n`
          contextSection += `*Command failed: ${errorResult.stderr}*\n\n`
        }
      }

      return {
        processedContent: cleanContent + contextSection,
        bashResults,
      }
    }

    return {
      processedContent: content,
      bashResults: [],
    }
  }

  /**
   * Check if a custom command exists
   */
  export async function customCommandExists(
    commandName: string,
  ): Promise<boolean> {
    const command = await getCustomCommand(commandName)
    return command !== null
  }

  /**
   * Recursively scan a directory for markdown command files
   */
  async function scanCommandsDirectory(
    baseDir: string,
    relativePath: string,
    isGlobal: boolean,
  ): Promise<CustomCommand[]> {
    const commands: CustomCommand[] = []
    const currentDir = path.join(baseDir, relativePath)

    try {
      const entries = await fs.readdir(currentDir)

      for (const entry of entries) {
        const entryPath = path.join(currentDir, entry)
        const stat = await fs.stat(entryPath)

        if (stat.isDirectory()) {
          // Recursively scan subdirectories
          const subPath = relativePath ? path.join(relativePath, entry) : entry
          const subCommands = await scanCommandsDirectory(
            baseDir,
            subPath,
            isGlobal,
          )
          commands.push(...subCommands)
        } else if (entry.endsWith(".md")) {
          // Calculate relative path from base commands directory
          const relativeFilePath = relativePath
            ? path.join(relativePath, entry)
            : entry

          // Convert file path to command name with colon notation
          const commandName = relativeFilePath
            .replace(/\.md$/, "")
            .replace(/[/\\]/g, ":")

          try {
            const content = await fs.readFile(entryPath, "utf-8")

            // Extract description from frontmatter or first line
            const description = extractDescription(content)

            commands.push({
              name: commandName,
              description,
              content,
              filePath: entryPath,
              isGlobal,
            })
          } catch (error) {
            log.warn("failed to read command file", { path: entryPath, error })
          }
        }
      }
    } catch (error) {
      // Directory doesn't exist or can't be read, return empty array
      log.info("commands directory not accessible", { dir: currentDir, error })
    }

    return commands
  }

  /**
   * Extract description from command content (frontmatter or first line)
   */
  function extractDescription(content: string): string | undefined {
    const lines = content.split("\n")

    // Check for frontmatter
    if (lines[0]?.trim() === "---") {
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim()
        if (line === "---") break
        if (line.startsWith("description:")) {
          return line
            .substring("description:".length)
            .trim()
            .replace(/^["']|["']$/g, "")
        }
      }
    }

    // Fallback to first non-empty line or first heading
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed && !trimmed.startsWith("#")) {
        return trimmed.length > 100
          ? trimmed.substring(0, 100) + "..."
          : trimmed
      }
      if (trimmed.startsWith("# ")) {
        return trimmed.substring(2).trim()
      }
    }

    return undefined
  }
}
