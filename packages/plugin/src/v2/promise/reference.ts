import type { ReferenceApi } from "@opencode-ai/client/promise/api"
import type { ReferenceDraft } from "../effect/reference.js"
import type { Transform } from "./registration.js"

export type { ReferenceDraft }

export interface ReferenceDomain extends ReferenceApi {
  readonly transform: Transform<ReferenceDraft>
  readonly reload: () => Promise<void>
}
