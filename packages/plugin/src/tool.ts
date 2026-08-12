import { z } from "zod"

export type ToolContext = {
  sessionID: string
  messageID: string
  agent: string
  /**
   * Current project directory for this session.
   * Prefer this over process.cwd() when resolving relative paths.
   */
  directory: string
  /**
   * Project worktree root for this session.
   * Useful for generating stable relative paths (e.g. path.relative(worktree, absPath)).
   */
  worktree: string
  abort: AbortSignal
  metadata(input: { title?: string; metadata?: { [key: string]: any } }): void
  ask(input: AskInput): Promise<void>
  /**
   * Present an interactive question popup (the same modal the `question`
   * tool uses) and wait for the user's answer. Resolves with the selected
   * labels per question, in order; rejects if the user dismisses the modal.
   */
  question(input: QuestionInput): Promise<ReadonlyArray<QuestionAnswer>>
}

type AskInput = {
  permission: string
  patterns: string[]
  always: string[]
  metadata: { [key: string]: any }
}

export type QuestionOption = {
  label: string
  description: string
}

export type QuestionInfo = {
  question: string
  header: string
  options: ReadonlyArray<QuestionOption>
  multiple?: boolean
  custom?: boolean
  /**
   * Pre-fills the custom answer field with this text, so callers can present
   * proposed content for the user to review and edit before submitting.
   */
  default?: string
}

export type QuestionInput = {
  questions: ReadonlyArray<QuestionInfo>
}

export type QuestionAnswer = ReadonlyArray<string>

export type ToolAttachment = {
  type: "file"
  mime: string
  url: string
  filename?: string
}

export type ToolResult =
  | string
  | {
      title?: string
      output: string
      metadata?: { [key: string]: any }
      attachments?: ToolAttachment[]
    }

export function tool<Args extends z.ZodRawShape>(input: {
  description: string
  args: Args
  execute(args: z.infer<z.ZodObject<Args>>, context: ToolContext): Promise<ToolResult>
}) {
  return input
}
tool.schema = z

export type ToolDefinition = ReturnType<typeof tool>
