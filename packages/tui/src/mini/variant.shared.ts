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
import { modelLabelKey, modelLabels, modelName, modelProviderName, type ModelLabel } from "../util/model-label"

// The same short names as the prompt: no provider for native Console models, and `OpenCode / <Provider>` only for a
// managed provider that is also connected directly. Without a catalog, the raw IDs.
export function modelInfo(providers: RunProvider[] | undefined, model: NonNullable<RunInput["model"]>): ModelLabel {
  if (!providers) return { provider: model.providerID, model: model.modelID }
  const models = providers.flatMap((provider) =>
    Object.entries(provider.models).map(([id, info]) => ({
      providerID: provider.id,
      id,
      name: info.name ?? id,
      status: info.status,
    })),
  )
  const label = modelLabels(providers, models).get(modelLabelKey(model.providerID, model.modelID))
  if (label) return label
  const name = providers.find((item) => item.id === model.providerID)?.models[model.modelID]?.name
  return {
    provider: modelProviderName(model.providerID, providers),
    model: name ? modelName(name) : model.modelID,
  }
}

export function formatModelLabel(
  model: NonNullable<RunInput["model"]>,
  variant: string | undefined,
  providers?: RunProvider[],
): string {
  const names = modelInfo(providers, model)
  const label = variant ? ` · ${variant}` : ""
  const name = names.provider ? `${names.model} · ${names.provider}` : names.model
  return `${name}${label}`
}

export function cycleVariant(current: string | undefined, variants: string[]): string | undefined {
  return cycleModelVariant(current, variants)
}

export function pickVariant(model: RunInput["model"], input: RunSession | SessionMessages): string | undefined {
  return sessionVariant(Array.isArray(input) ? createSession(input) : input, model)
}

function fitVariant(value: string | undefined, variants: string[]): string | undefined {
  const normalized = normalizeModelVariant(value)
  return normalized && (variants.length === 0 || variants.includes(normalized)) ? normalized : undefined
}

// Picks the active variant. CLI flag wins, then valid session history, then the
// saved preference. Saved and session values are dropped when the provider no
// longer offers them.
export function resolveVariant(
  input: string | undefined,
  session: string | undefined,
  saved: string | undefined,
  variants: string[],
): string | undefined {
  if (input !== undefined) {
    return normalizeModelVariant(input)
  }

  return fitVariant(session, variants) ?? fitVariant(saved, variants)
}
