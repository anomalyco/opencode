import fs from "fs/promises"
import path from "path"
import { Global } from "../global"
import { Log } from "../util/log"
import { App } from "../app/app"
import { BANNED_COMMANDS } from "../tool/bash"

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
    if (BANNED_COMMANDS.some((item) => command.startsWith(item))) {
      throw new Error(`Command '${command}' is not allowed`)
    }

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
}
