import type { ReferenceGitSource, ReferenceInfo, ReferenceLocalSource } from "@opencode-ai/sdk/v2/types"
import type { Effect } from "effect"
import type { Transformable } from "./registration.js"

export interface ReferenceDraft {
  add(name: string, source: ReferenceLocalSource | ReferenceGitSource): void
  remove(name: string): void
  list(): readonly (readonly [string, ReferenceLocalSource | ReferenceGitSource])[]
}

export interface Reference extends Transformable<ReferenceDraft> {
  list(): Effect.Effect<ReferenceInfo[]>
}
