import * as path from "path"
import type { CommandExecutionContext } from "./types"
import { File } from "../file"
import { Global } from "../global"
import { App } from "../app/app"

export class CommandResolver {
  constructor(private app?: App.Info) {}

  async resolve(content: string, context: CommandExecutionContext): Promise<string> {
    // Validate argument count if specified
    this.validateArgumentCount(context)

    let resolved = content

    // Step 1: Resolve file references
    resolved = await this.resolveFileReferences(resolved, context)

    // Step 2: Resolve arguments
    resolved = this.resolveArguments(resolved, context.arguments)

    return resolved
  }

  private validateArgumentCount(context: CommandExecutionContext): void {
    // Count the number of $ARGUMENTS or {{args}} placeholders in the content
    const content = context.command.rawContent
    const placeholderMatches = content.match(/(\$ARGUMENTS|\{\{args\}\})/g)

    if (!placeholderMatches || placeholderMatches.length === 0) {
      // No placeholders, no arguments expected
      if (context.arguments.trim()) {
        throw new Error(`Command '${context.command.name}' does not accept arguments`)
      }
      return
    }

    const expectedCount = placeholderMatches.length

    // Count the number of arguments provided
    const args = context.arguments.trim()
    const argArray = args ? args.split(/\s+/) : []
    const providedCount = argArray.length

    if (providedCount !== expectedCount) {
      throw new Error(
        `Command '${context.command.name}' expects exactly ${expectedCount} argument${
          expectedCount === 1 ? "" : "s"
        }, but ${providedCount} ${providedCount === 1 ? "was" : "were"} provided`,
      )
    }
  }

  private getBaseDirectory(context: CommandExecutionContext): string {
    // For user (global) commands, file references should be relative to the user's config directory
    // For project commands, file references should be relative to the project root

    if (context.command.scope === "user") {
      // Use the global config directory as base for user commands
      return Global.Path.config
    } else {
      // Use the project root for project commands (if available)
      // Fall back to working directory if app context is not available
      return this.app?.path.root || context.workingDirectory
    }
  }

  private async resolveFileReferences(content: string, context: CommandExecutionContext): Promise<string> {
    // Match @{file/path} pattern
    const fileRegex = /@\{([^}]+)\}/g
    const matches = Array.from(content.matchAll(fileRegex))

    for (const match of matches) {
      const [fullMatch, filePath] = match

      try {
        let absolutePath: string

        if (path.isAbsolute(filePath)) {
          // If absolute path, use as-is
          absolutePath = filePath
        } else {
          // For relative paths, we have two resolution strategies:
          // 1. First try relative to the command file itself
          // 2. If that fails, try relative to the base directory

          const commandDir = path.dirname(context.command.path)
          const pathRelativeToCommand = path.resolve(commandDir, filePath)

          // Check if file exists relative to command
          try {
            await File.read(pathRelativeToCommand)
            absolutePath = pathRelativeToCommand
          } catch {
            // If not found relative to command, try base directory
            const baseDir = this.getBaseDirectory(context)
            absolutePath = path.resolve(baseDir, filePath)
          }
        }

        const fileContent = await File.read(absolutePath)

        // Limit file size to prevent memory issues
        const truncated = fileContent.content.slice(0, 1024 * 1024) // 1MB limit
        const formatted = `\n\`\`\`\n${truncated}\n\`\`\`\n`

        content = content.replace(fullMatch, formatted)
      } catch (error) {
        content = content.replace(fullMatch, `[File not found: ${filePath}]`)
      }
    }

    return content
  }

  private resolveArguments(content: string, args: string): string {
    // Split arguments into array
    const argArray = args.trim() ? args.trim().split(/\s+/) : []
    let argIndex = 0

    // Replace both $ARGUMENTS and {{args}} placeholders in order
    content = content.replace(/(\$ARGUMENTS|\{\{args\}\})/g, () => {
      if (argIndex < argArray.length) {
        return argArray[argIndex++]
      }
      return "" // This shouldn't happen due to validation
    })

    return content
  }
}
