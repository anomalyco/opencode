import type { SessionID } from "../schema"
import type { MemoryFactTable, MemoryWindowTable, MemoryArtifactTable, MemoryProjectTable } from "../session.sql"

export type MemoryFact = typeof MemoryFactTable.$inferSelect
export type NewFact = typeof MemoryFactTable.$inferInsert

export type MemoryWindow = typeof MemoryWindowTable.$inferSelect
export type NewWindow = typeof MemoryWindowTable.$inferInsert

export type MemoryArtifact = typeof MemoryArtifactTable.$inferSelect
export type NewArtifact = typeof MemoryArtifactTable.$inferInsert

export type MemoryProject = typeof MemoryProjectTable.$inferSelect

export interface ExtractionResult {
  goal: string
  instructions: string[]
  discoveries: string[]
  accomplished: string[]
  in_progress: string[]
  blocked_on: string[]
  files_touched: string[]
  relevant_dirs: string[]
  facts: Array<{ category: string; subject: string; value: string }>
  artifacts: Array<{ kind: string; content: string; file_path?: string }>
}
