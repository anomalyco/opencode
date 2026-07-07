import type { ReferenceApi } from "@opencode-ai/client/promise/api"
import type { ReferenceDraft } from "../effect/reference.js"
import type { Hooks, Transform } from "./registration.js"

export type { ReferenceDraft }

export interface ReferenceHooks {}

export interface ReferenceDomain extends ReferenceApi {
  readonly hook: Hooks<ReferenceHooks>
  readonly transform: Transform<ReferenceDraft>
  readonly reload: () => Promise<void>
}
