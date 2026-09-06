import type { WorktreeApi } from "@opencode-ai/client/promise/api"
import type { WorktreeCreateInput, WorktreeEntry, WorktreeRemoveInput, WorktreeResult } from "../worktree.js"
import type { Transform } from "./registration.js"

export interface WorktreeDefinition {
  readonly id: string
  readonly create: (input: WorktreeCreateInput, context: { readonly signal: AbortSignal }) => Promise<WorktreeResult>
  readonly remove: (input: WorktreeRemoveInput, context: { readonly signal: AbortSignal }) => Promise<void>
  readonly list: (
    sourceDirectory: string,
    context: { readonly signal: AbortSignal },
  ) => Promise<readonly WorktreeEntry[]>
}

export interface WorktreeEditor {
  /** Registers an implementation and selects it as the default. Later active registrations win. */
  add(definition: WorktreeDefinition): void
}

export interface WorktreeDomain extends WorktreeApi {
  readonly transform: Transform<WorktreeEditor>
  readonly reload: () => Promise<void>
}
