import { reconcile, type SetStoreFunction } from "solid-js/store"
import type { SubagentDraftState } from "./subagent-draft"

/**
 * The draft is one value: `setStore` merges a plain object and keeps the keys it does not mention, so a cleared retry
 * would leave a delivered admission ID behind and a later identical message would be dropped as a duplicate.
 * Reconciling replaces the stored draft instead.
 */
export function subagentDraftStorage(draft: () => SubagentDraftState, set: SetStoreFunction<SubagentDraftState>) {
  return { draft, set: (value: SubagentDraftState) => set(reconcile(value)) }
}
