import type { ReferenceApi } from "@opencode-ai/client/promise/api"
import type { ReferenceGitSource, ReferenceLocalSource } from "@opencode-ai/client"
import type { Transform } from "./registration.js"

export interface ReferenceDraft {
  add(name: string, source: ReferenceLocalSource | ReferenceGitSource): void
  remove(name: string): void
  list(): readonly (readonly [string, ReferenceLocalSource | ReferenceGitSource])[]
}

export interface ReferenceDomain extends ReferenceApi {
  readonly transform: Transform<ReferenceDraft>
  readonly reload: () => Promise<void>
}
