import type { WorktreeApi } from "@opencode-ai/client/effect/api"
import type { Effect } from "effect"
import type { WorktreeCreateInput, WorktreeEntry, WorktreeRemoveInput, WorktreeResult } from "../worktree.js"
import type { Transform } from "./registration.js"

export interface WorktreeDefinition {
  readonly id: string
  readonly create: (input: WorktreeCreateInput) => Effect.Effect<WorktreeResult, unknown>
  readonly remove: (input: WorktreeRemoveInput) => Effect.Effect<void, unknown>
  readonly list: (sourceDirectory: string) => Effect.Effect<readonly WorktreeEntry[], unknown>
}

export interface WorktreeEditor {
  /** Registers an implementation and selects it as the default. Later active registrations win. */
  add(definition: WorktreeDefinition): void
}

export interface WorktreeDomain extends WorktreeApi<unknown> {
  readonly transform: Transform<WorktreeEditor>
  readonly reload: () => Effect.Effect<void>
}
