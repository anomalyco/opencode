import { z } from "zod/v4"

export type ToolContext = {
  sessionID: string
  messageID: string
  agent: string
  abort: AbortSignal
}

export type ToolResult = {
  output: string
  title?: string
  metadata?: Record<string, unknown>
}

export type ToolDefinition<Args extends z.ZodRawShape = z.ZodRawShape> = {
  description: string
  args: Args
  execute(args: z.infer<z.ZodObject<Args>>, context: ToolContext): Promise<string | ToolResult>
}

export function tool<Args extends z.ZodRawShape>(input: ToolDefinition<Args>) {
  return input
}
tool.schema = z

export type ToolExecute<Args extends z.ZodRawShape = z.ZodRawShape> = ToolDefinition<Args>["execute"]
