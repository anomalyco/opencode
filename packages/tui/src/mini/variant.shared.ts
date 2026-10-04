import { Model } from "@opencode/schema/model"
// Model variant resolution and persistence.
//
// Variants are provider-specific reasoning effort levels (e.g., "high", "max").
// Resolution priority: CLI --variant flag > valid session history > saved preference.
//
// The saved variant persists across sessions in ~/.local/state/opencode/model.json
// so your last-used variant sticks. Cycling (ctrl+t) updates both the active
// variant and the persisted file.
import { createSession, sessionVariant, type RunSession, type SessionMessages } from "./session.shared"
import type { RunInput, RunProvider } from "./types"
import { cycleModelVariant, normalizeModelVariant } from "../model-preference"

export function modelInfo(providers: RunProvider[] | undefined, model: NonNullable<RunInput["model"]>) {
  const provider = providers?.find((item) => item.id === model.providerID)
  return {
    provider: provider?.name ?? model.providerID,
    model: provider?.models[model.modelID]?.name ?? model.modelID,
  }
}

export function formatModelLabel(
  model: NonNullable<RunInput["model"]>,
  variant: string | undefined,
  providers?: RunProvider[],
): string {
  const names = modelInfo(providers, model)
  const label = variant ? ` · ${variant}` : ""
  return `${names.model} · ${names.provider}${label}`
}

export function cycleVariant(current: string | undefined, variants: string[]): Model.VariantID | undefined {
  const variant = cycleModelVariant(current, variants)
  return variant === undefined ? undefined : Model.VariantID.make(variant)
}

export function pickVariant(model: RunInput["model"], input: RunSession | SessionMessages): string | undefined {
  return sessionVariant(Array.isArray(input) ? createSession(input) : input, model)
}

function fitVariant(value: string | undefined, variants: string[]): Model.VariantID | undefined {
  const normalized = normalizeModelVariant(value)
  return normalized && (variants.length === 0 || variants.includes(normalized))
    ? Model.VariantID.make(normalized)
    : undefined
}

// Picks the active variant. CLI flag wins, then valid session history, then the
// saved preference. Saved and session values are dropped when the provider no
// longer offers them.
export function resolveVariant(
  input: string | undefined,
  session: string | undefined,
  saved: string | undefined,
  variants: string[],
): Model.VariantID | undefined {
  if (input !== undefined) {
    const variant = normalizeModelVariant(input)
    return variant === undefined ? undefined : Model.VariantID.make(variant)
  }

  return fitVariant(session, variants) ?? fitVariant(saved, variants)
}
