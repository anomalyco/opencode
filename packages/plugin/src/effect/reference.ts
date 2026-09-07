import type { ReferenceGitSource, ReferenceLocalSource } from "@opencode-ai/client"
import type { ReferenceApi } from "@opencode-ai/client/effect/api"
import type { Effect } from "effect"
import type { Transform } from "./registration.js"

export interface ReferenceEditor {
  add(name: string, source: ReferenceLocalSource | ReferenceGitSource): void
  remove(name: string): void
  list(): readonly (readonly [string, ReferenceLocalSource | ReferenceGitSource])[]
  get(name: string): ReferenceLocalSource | ReferenceGitSource | undefined
}

export interface ReferenceDomain extends ReferenceApi<unknown> {
  readonly transform: Transform<ReferenceEditor>
  readonly reload: () => Effect.Effect<void>
}
