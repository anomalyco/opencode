import { z } from "zod"

export type ToolContext = {
  sessionID: string
  messageID: string
  agent: string
  abort: AbortSignal
  log(level: "debug" | "info" | "warn" | "error", message: string, extra?: Record<string, unknown>): void
}

export function tool<Args extends z.ZodRawShape>(input: {
  description: string
  args: Args
  execute(args: z.infer<z.ZodObject<Args>>, context: ToolContext): Promise<string>
}) {
  return input
}
tool.schema = z

export type ToolDefinition = ReturnType<typeof tool>
