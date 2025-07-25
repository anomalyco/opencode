import * as path from "path"
import type { CommandExecutionContext } from "./types"
import { File } from "../file"

export class CommandResolver {
  constructor() {}

  async resolve(content: string, context: CommandExecutionContext): Promise<string> {
    // Validate argument count if specified
    this.validateArgumentCount(context)

    let resolved = content

    // Step 1: Resolve bash commands
    resolved = await this.resolveBashCommands(resolved, context)

    // Step 2: Resolve file references
    resolved = await this.resolveFileReferences(resolved, context)

    // Step 3: Resolve arguments
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

  private async resolveBashCommands(content: string, context: CommandExecutionContext): Promise<string> {
    // Match $(command) pattern
    const bashRegex = /\$\(([^)]+)\)/g
    const matches = Array.from(content.matchAll(bashRegex))

    for (const match of matches) {
      const [fullMatch, command] = match

      try {
        // Execute command with timeout
        const proc = Bun.spawn(["bash", "-c", command], {
          cwd: context.workingDirectory,
          env: process.env,
        })

        const timeout = setTimeout(() => proc.kill(), 30000) // 30s timeout
        const output = await new Response(proc.stdout).text()
        const error = await new Response(proc.stderr).text()
        clearTimeout(timeout)

        const result = proc.exitCode === 0 ? output : `${output}\n${error}`
        content = content.replace(fullMatch, result.trim())
      } catch (error) {
        content = content.replace(fullMatch, `[Error executing: ${command}]`)
      }
    }

    return content
  }

  private async resolveFileReferences(content: string, context: CommandExecutionContext): Promise<string> {
    // Match @{file/path} pattern
    const fileRegex = /@\{([^}]+)\}/g
    const matches = Array.from(content.matchAll(fileRegex))

    for (const match of matches) {
      const [fullMatch, filePath] = match

      try {
        // Resolve relative to command file directory
        const commandDir = path.dirname(context.command.path)
        const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(commandDir, filePath)

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

    // Replace $ARGUMENTS placeholders one by one
    content = content.replace(/\$ARGUMENTS/g, () => {
      if (argIndex < argArray.length) {
        return argArray[argIndex++]
      }
      return "" // This shouldn't happen due to validation
    })

    // Reset index for {{args}} pattern
    argIndex = 0
    content = content.replace(/\{\{args\}\}/g, () => {
      if (argIndex < argArray.length) {
        return argArray[argIndex++]
      }
      return "" // This shouldn't happen due to validation
    })

    return content
  }
}
