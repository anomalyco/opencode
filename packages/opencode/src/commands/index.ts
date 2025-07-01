import fs from "fs/promises"
import path from "path"
import { Global } from "../global"
import { Log } from "../util/log"

export namespace Commands {
  const log = Log.create({ service: "commands" })

  export interface CommandFile {
    name: string
    filename: string
    content: string
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
