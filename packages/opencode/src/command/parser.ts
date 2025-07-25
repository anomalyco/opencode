import { ParsedToolRestriction } from "./types"

export class CommandParser {
  /**
   * Parse allowed-tools string into structured format
   * Examples:
   * - "Bash(git *)" -> { toolName: "Bash", allowedCommands: ["git *"] }
   * - "Read" -> { toolName: "Read", allowedCommands: undefined }
   * - "Bash(git add), Bash(git commit)" -> multiple restrictions
   */
  static parseAllowedTools(tools: string[]): ParsedToolRestriction[] {
    const restrictions: ParsedToolRestriction[] = []
    
    for (const tool of tools) {
      const match = tool.match(/^(\w+)(?:\(([^)]+)\))?$/)
      if (!match) {
        throw new Error(`Invalid tool format: ${tool}`)
      }
      
      const [, toolName, commandPattern] = match
      restrictions.push({
        toolName,
        allowedCommands: commandPattern ? [commandPattern] : undefined,
      })
    }
    
    return restrictions
  }

  /**
   * Validate that requested tools match allowed patterns
   */
  static validateToolUsage(
    requestedTool: string,
    requestedCommand: string | undefined,
    restrictions: ParsedToolRestriction[]
  ): boolean {
    const restriction = restrictions.find(r => r.toolName === requestedTool)
    if (!restriction) return false
    
    if (!restriction.allowedCommands) return true
    if (!requestedCommand) return false
    
    // Check if command matches any allowed pattern
    return restriction.allowedCommands.some(pattern => {
      const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$")
      return regex.test(requestedCommand)
    })
  }
}