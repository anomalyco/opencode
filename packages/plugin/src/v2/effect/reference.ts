import type { ReferenceGitSource, ReferenceLocalSource } from "@opencode-ai/sdk/v2/types"
import type { ReferenceApi } from "@opencode-ai/client/effect/api"
import type { Effect } from "effect"
import type { Hooks, Transform } from "./registration.js"

export interface ReferenceDraft {
  add(name: string, source: ReferenceLocalSource | ReferenceGitSource): void
  remove(name: string): void
  list(): readonly (readonly [string, ReferenceLocalSource | ReferenceGitSource])[]
}

export interface ReferenceHooks {}

export interface ReferenceDomain extends ReferenceApi<unknown> {
  readonly hook: Hooks<ReferenceHooks>
  readonly transform: Transform<ReferenceDraft>
  readonly reload: () => Effect.Effect<void>
}
