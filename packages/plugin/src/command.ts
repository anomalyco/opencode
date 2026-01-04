export type CommandDefinition = {
  template: string
  description?: string
  agent?: string
  model?: string
  subtask?: boolean
}

/**
 * Helper for defining a command with type safety.
 * @example
 * command({
 *   template: "Analyze the code in $1",
 *   description: "Run code analysis",
 *   agent: "build"
 * })
 */
export function command(input: CommandDefinition): CommandDefinition {
  return input
}
