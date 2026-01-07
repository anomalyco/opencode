import { z } from "zod"

export type ToolContext = {
  sessionID: string
  messageID: string
  agent: string
  abort: AbortSignal
  /**
   * Request user permission for an action. Throws if user denies.
   * @param input Permission request details
   */
  askPermission?: (input: {
    type: string
    title: string
    pattern?: string | string[]
    metadata: Record<string, any>
  }) => Promise<void>
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
