import { z } from "zod"

export type LspDiagnostic = {
  range: {
    start: { line: number; character: number }
    end: { line: number; character: number }
  }
  message: string
  severity?: number
  code?: number | string
  source?: string
}

export type LspContext = {
  /** Notify the language server that a file has changed and optionally wait for diagnostics. */
  touchFile(filePath: string, waitForDiagnostics?: boolean): Promise<void>
  /** Retrieve all current diagnostics across all open files. */
  diagnostics(): Promise<Record<string, LspDiagnostic[]>>
  /** Format a diagnostic into a human-readable string (e.g. "ERROR [12:5] message"). */
  diagnosticPretty(diagnostic: LspDiagnostic): string
  /** Get hover information at a position (one result per active LSP client; entries may be null). */
  hover(input: { file: string; line: number; character: number }): Promise<(unknown | null)[]>
}

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
  /** Access to LSP functionality (language server diagnostics, hover, etc.) */
  lsp?: LspContext
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
}) {
  return input
}
tool.schema = z

export type ToolDefinition = ReturnType<typeof tool>
