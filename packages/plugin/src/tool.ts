import { z } from "zod"
import type { FilePart } from "@opencode-ai/sdk"

export type ToolContext = {
  sessionID: string
  messageID: string
  agent: string
  abort: AbortSignal
  metadata(input: { title?: string; metadata?: Record<string, unknown> }): void
}

/**
 * Structured result for plugin tools.
 *
 * Return this instead of a plain string to provide rich metadata
 * that integrates with streaming updates.
 */
export interface ToolResult {
  /** Title displayed in the UI */
  title: string
  /** Arbitrary metadata passed to tool.execute.after hooks */
  metadata: Record<string, unknown>
  /** The text output returned to the model */
  output: string
  /** Optional file attachments to include with the result */
  attachments?: FilePart[]
}

export function tool<Args extends z.ZodRawShape>(input: {
  description: string
  args: Args
  execute(args: z.infer<z.ZodObject<Args>>, context: ToolContext): Promise<string | ToolResult>
}) {
  return input
}
tool.schema = z

export type ToolDefinition = ReturnType<typeof tool>
