import { z } from "zod"
import type { FilePart } from "@opencode-ai/sdk"

type Metadata = {
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
  ask(input: { permission: string; patterns: string[]; metadata: M; always: string[] }): Promise<void>
}

export type ExecuteResult<M extends Metadata = Metadata> = {
  title: string
  metadata: M
  output: string
  attachments?: FilePart[]
}

// NB: align with ReturnType<Info['init']> in packages/opencode/src/tool/tool.ts
export type Input<Args extends z.ZodRawShape, M extends Metadata = Metadata> = {
  description: string
  args: Args
  execute(args: z.infer<z.ZodObject<Args>>, context: ToolContext<M>): Promise<string | ExecuteResult<M>>
  formatValidationError?(error: z.ZodError): string
}

export function tool<Args extends z.ZodRawShape, M extends Metadata = Metadata>(input: Input<Args, M>) {
  return input
}
tool.schema = z

export type ToolDefinition = ReturnType<typeof tool>
