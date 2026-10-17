import type { ConfigGetOutput } from "@opencode/client/promise"
import { ConfigModel } from "@opencode/schema/config/model"
import { Option, Schema } from "effect"
import { modelPreferenceKey, type ModelPreferenceModel } from "../model-preference"
import type { RunProvider } from "./types"

const decodeSelection = Schema.decodeUnknownOption(ConfigModel.Selection)

// Mirrors the full TUI priority: explicit --model (applied by the caller), the
// configured model, the most recent available model, then the server default.
// Config entries stay in their wire form (`provider/model#variant` or an
// explicit object) and go through the canonical schema decoder.
export function resolveMiniModelPreference(input: {
  configured: ConfigGetOutput
  recent: ModelPreferenceModel[]
  providers: RunProvider[]
}): { model: ModelPreferenceModel | undefined; variant: string | undefined; warning: string | undefined } {
  const available = (model: ModelPreferenceModel) =>
    input.providers.some((provider) => provider.id === model.providerID && provider.models[model.modelID])
  const entry = input.configured.findLast((entry) => entry.type === "document" && entry.info.model !== undefined)
  const selection = entry?.type === "document" ? Option.getOrUndefined(decodeSelection(entry.info.model)) : undefined
  const configured = selection && { providerID: selection.providerID, modelID: selection.model }
  if (configured && available(configured)) return { model: configured, variant: selection?.variant, warning: undefined }

  const model = input.recent.find(available)
  // Report the candidate that would have won: an unavailable configured model
  // takes precedence over an unavailable recent model, so a stale preference is
  // never mistaken for the restored one.
  const skipped = configured ?? (input.recent[0] && !available(input.recent[0]) ? input.recent[0] : undefined)
  if (!skipped) return { model, variant: undefined, warning: undefined }
  const target = model ? modelPreferenceKey(model) : "the server default"
  const source = configured ? "Configured" : "Recent"
  return {
    model,
    variant: undefined,
    warning: `${source} model ${modelPreferenceKey(skipped)} is unavailable or its provider is not connected. Falling back to ${target}.`,
  }
}
