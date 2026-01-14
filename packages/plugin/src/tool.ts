import { z } from "zod"

export type ToolContext = {
  sessionID: string
  messageID: string
  agent: string
  abort: AbortSignal
  metadata(input: { title?: string; metadata?: { [key: string]: any } }): void
  ask(input: AskInput): Promise<void>
}

type AskInput = {
  permission: string
  patterns: string[]
  always: string[]
  metadata: { [key: string]: any }
}

export function tool<Args extends z.ZodRawShape>(input: {
  description: string
  args: Args
  execute(args: z.infer<z.ZodObject<Args>>, context: ToolContext): Promise<string>
  /** Expose this tool as a slash command in the autocomplete (requires experimental.pluginCommands) */
  command?: boolean
  /** Execute directly without AI processing (only applies when command is true) */
  directExecution?: boolean
}) {
  return input
}
tool.schema = z

export type ToolDefinition = ReturnType<typeof tool>
