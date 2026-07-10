import type { ReferenceDraft } from "../effect/reference.js"
import type { Hooks } from "./registration.js"

export type { ReferenceDraft }

export type ReferenceHooks = Hooks<{
  transform: ReferenceDraft
}>
