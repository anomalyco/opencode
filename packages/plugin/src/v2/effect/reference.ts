import type { ReferenceGitSource, ReferenceLocalSource } from "@kancode/sdk/v2/types"
import type { Hooks } from "./registration.js"

export interface ReferenceDraft {
  add(name: string, source: ReferenceLocalSource | ReferenceGitSource): void
  remove(name: string): void
  list(): readonly (readonly [string, ReferenceLocalSource | ReferenceGitSource])[]
}

export type ReferenceHooks = Hooks<{
  transform: ReferenceDraft
}>
