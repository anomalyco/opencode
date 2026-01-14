import { z } from "zod"
import type { FilePart } from "@opencode-ai/sdk"

export type Metadata = {
  [key: string]: any
}

export type ToolContext<M extends Metadata = Metadata> = {
  sessionID: string
  messageID: string
  agent: string
  abort: AbortSignal
  callID?: string
  extra?: M
  metadata(input: { title?: string; metadata?: M }): void
  ask(input: AskInput<M>): Promise<void>
}

export type AskInput<M extends Metadata = Metadata> = {
  permission: string
  patterns: string[]
  always: string[]
  metadata: M
}

export type ExecuteResult<M extends Metadata = Metadata> = {
  title: string
  metadata: M
  output: string
  attachments?: FilePart[]
}

export function tool<Args extends z.ZodRawShape, M extends Metadata = Metadata>(input: {
  description: string
  args: Args
  execute(args: z.infer<z.ZodObject<Args>>, context: ToolContext<M>): Promise<string | ExecuteResult<M>>
  formatValidationError?(error: z.ZodError): string
}) {
  return input
}
tool.schema = z

export type ToolDefinition = ReturnType<typeof tool>
