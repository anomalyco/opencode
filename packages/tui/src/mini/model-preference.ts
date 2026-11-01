import type { ConfigGetOutput } from "@opencode/client/promise"
import { ConfigModel } from "@opencode/schema/config/model"
import { Option, Schema } from "effect"
import { modelPreferenceKey, type ModelPreferenceModel } from "../model-preference"
import type { RunAgent, RunProvider } from "./types"

const decodeSelection = Schema.decodeUnknownOption(ConfigModel.Selection)

// Automatic selection prefers the agent model, the configured model, then the
// most recent available model. Explicit and session models are handled by the caller.
// Config entries stay in their wire form (`provider/model#variant` or an
// explicit object) and go through the canonical schema decoder.
export function resolveMiniModelPreference(input: {
  agent?: RunAgent["model"]
  configured: ConfigGetOutput
  recent: ModelPreferenceModel[]
  providers: RunProvider[]
}): { model: ModelPreferenceModel | undefined; variant: string | undefined; warning: string | undefined } {
  const available = (model: ModelPreferenceModel) =>
    input.providers.some((provider) => provider.id === model.providerID && provider.models[model.modelID])
  const entry = input.configured.findLast((entry) => entry.type === "document" && entry.info.model !== undefined)
  const selection = entry?.type === "document" ? Option.getOrUndefined(decodeSelection(entry.info.model)) : undefined
  const configured = selection && { providerID: selection.providerID, modelID: selection.model }
  const agent = input.agent && { providerID: input.agent.providerID, modelID: input.agent.modelID }
  const candidates = [
    ...(agent
      ? [
          {
            source: "Agent",
            model: agent,
            variant:
              input.agent?.variant ??
              (agent.providerID === configured?.providerID && agent.modelID === configured.modelID
                ? selection?.variant
                : undefined),
          },
        ]
      : []),
    ...(configured ? [{ source: "Configured", model: configured, variant: selection?.variant }] : []),
    ...input.recent.map((model) => ({ source: "Recent", model, variant: undefined })),
  ]
  const selected = candidates.find((candidate) => available(candidate.model))
  // Explain the highest-priority preference that would otherwise have won.
  const skipped = candidates[0] && !available(candidates[0].model) ? candidates[0] : undefined
  return {
    model: selected?.model,
    variant: selected?.variant,
    warning: skipped
      ? `${skipped.source} model ${modelPreferenceKey(skipped.model)} is unavailable or its provider is not connected. Falling back to ${selected ? modelPreferenceKey(selected.model) : "the server default"}.`
      : undefined,
  }
}
