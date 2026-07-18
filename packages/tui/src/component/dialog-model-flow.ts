import * as fuzzysort from "fuzzysort"
import { sortBy } from "remeda"

export type ModelRef = { providerID: string; modelID: string }

/**
 * Config pickers pass `onSelect` and must not fall back to the live session model
 * when `current` is unset. Session pickers use `current ?? sessionCurrent`.
 */
export function resolveSelectionCurrent(input: {
  configPicker: boolean
  current?: ModelRef
  sessionCurrent?: ModelRef
}): ModelRef | undefined {
  if (input.configPicker) return input.current
  return input.current ?? input.sessionCurrent
}

/**
 * Provider id used to boost search ranking. Config pickers boost `current`
 * (the picker selection); session pickers boost the live session provider.
 */
export function resolveSearchBoostProviderID(input: {
  configPicker: boolean
  current?: ModelRef
  sessionCurrent?: ModelRef
}): string | undefined {
  return resolveSelectionCurrent(input)?.providerID
}

export type ModelSelectAction =
  | { type: "callback"; providerID: string; modelID: string }
  | { type: "open-variants"; model: ModelRef }
  | { type: "set-model"; model: ModelRef }

/**
 * Enter on a model row: config pickers only invoke the callback; session pickers
 * open the variant dialog when the model has variants, otherwise set the model.
 */
export function resolveModelSelect(input: {
  providerID: string
  modelID: string
  configPicker: boolean
  hasVariants: boolean
}): ModelSelectAction {
  if (input.configPicker) {
    return { type: "callback", providerID: input.providerID, modelID: input.modelID }
  }
  const model = { providerID: input.providerID, modelID: input.modelID }
  if (input.hasVariants) return { type: "open-variants", model }
  return { type: "set-model", model }
}

export type VariantApplyAction =
  | { type: "config-callback"; model: ModelRef }
  | { type: "set-model-and-variant"; model: ModelRef; variant: string | undefined }
  | { type: "set-variant"; variant: string | undefined }

/**
 * Applying a variant from the model picker must not mutate the session model when
 * the picker is a config target (`onSelect` set). Config flows only report the model.
 */
export function resolveVariantApply(input: {
  model?: ModelRef
  configPicker: boolean
  variant: string | undefined
}): VariantApplyAction {
  if (input.model) {
    if (input.configPicker) return { type: "config-callback", model: input.model }
    return { type: "set-model-and-variant", model: input.model, variant: input.variant }
  }
  return { type: "set-variant", variant: input.variant }
}

/**
 * After fuzzysort, boost matches from the active provider while preserving
 * score order within each group. Primary key is current-provider membership;
 * secondary key is original match index (better score first).
 */
export function boostCurrentProviderMatches<T extends { value: { providerID: string } }>(
  matches: T[],
  currentProviderID: string | undefined,
): T[] {
  if (!currentProviderID) return matches
  return sortBy(
    matches.map((obj, i) => ({ obj, i })),
    (item) => (item.obj.value.providerID === currentProviderID ? 0 : 1),
    [(item) => item.i, "asc"],
  ).map((item) => item.obj)
}

/**
 * Shared model-dialog search ranking: fuzzysort relevance, then boost the
 * picker/session current provider. Do not re-sort the result by free/date.
 */
export function rankModelSearchMatches<
  T extends { title: string; category?: string; value: { providerID: string } },
>(needle: string, options: T[], boostProviderID: string | undefined): T[] {
  const matches = fuzzysort.go(needle, options, { keys: ["title", "category"] }).map((x) => x.obj)
  return boostCurrentProviderMatches(matches, boostProviderID)
}

export type RightMode =
  | { kind: "provider"; providerID: string }
  | { kind: "hidden" }
  | { kind: "favorites" }
  | { kind: "recents" }

/** Stable key for right-pane content; used to detect provider/search switches. */
export function rightPaneContentKey(input: {
  mode: RightMode | null
  searching: boolean
  query: string
}): string {
  if (input.searching) return `search:${input.query.trim().toLowerCase()}`
  const mode = input.mode
  if (!mode) return ""
  return mode.kind === "provider" ? `provider:${mode.providerID}` : mode.kind
}

/** True when previewing the left entry would not change the right-pane mode. */
export function isSameRightMode(current: RightMode | null, next: RightMode): boolean {
  if (!current || current.kind !== next.kind) return false
  if (next.kind === "provider") {
    return current.kind === "provider" && current.providerID === next.providerID
  }
  return true
}
