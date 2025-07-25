import { z } from "zod"

// Zod schemas for validation
export const CommandMetadataSchema = z.object({
  description: z.string().optional(),
  "allowed-tools": z.array(z.string()).optional(),
  "argument-hint": z.string().optional(),
})

export const CustomCommandSchema = z.object({
  name: z.string(),
  path: z.string(),
  scope: z.enum(["project", "user"]),
  namespace: z.string().optional(),
  metadata: CommandMetadataSchema,
  rawContent: z.string(),
  processedContent: z.string().optional(),
})

// TypeScript types
export type CommandMetadata = z.infer<typeof CommandMetadataSchema>
export type CustomCommand = z.infer<typeof CustomCommandSchema>

export interface CommandExecutionContext {
  command: CustomCommand
  arguments: string
  sessionId: string
  messageId: string
  workingDirectory: string
  abortSignal?: AbortSignal
}

export interface CommandExecutionResult {
  success: boolean
  output?: string
  error?: string
}

// Tool restriction parser
export interface ParsedToolRestriction {
  toolName: string
  allowedCommands?: string[]
}