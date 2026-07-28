export * from "./generated/index"
export type { EventsSubscribeOutput as OpenCodeEvent } from "./generated/types"
export type FileDiffInfo = {
  file: string
  patch?: string
  before?: string
  after?: string
  additions: number
  deletions: number
  status?: "added" | "deleted" | "modified"
}

