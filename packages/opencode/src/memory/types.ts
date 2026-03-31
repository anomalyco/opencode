import z from "zod"

export const MemoryType = z.enum([
  "error-solution",
  "build-command",
  "preference",
  "decision",
  "config-pattern",
  "general",
])
export type MemoryType = z.infer<typeof MemoryType>

export interface Memory {
  id: string
  projectPath: string
  type: MemoryType
  topic: string
  content: string
  createdAt: Date
  accessedAt: Date
  accessCount: number
  sessionId?: string
}
