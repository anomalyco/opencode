export * as VariantPlugin from "./variant.js"

import { Effect } from "effect"
import { define } from "@opencode-ai/plugin/effect/plugin"
import { Model } from "../model.js"
import { Provider } from "../provider.js"

export const Plugin = define({
  id: "opencode.variant",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.catalog.transform((catalog) => {
      for (const record of catalog.provider.list()) {
        for (const model of record.models.values()) {
          catalog.model.update(model.providerID, model.id, (draft) => {
            const generated = generate(draft, record.provider)
            if (generated.length === 0) return

            const variants = draft.variants ?? []
            const explicit = new Map(variants.map((variant) => [variant.id, variant]))
            const generatedIDs = new Set<string>(generated.map((variant) => variant.id))
            draft.variants = [
              ...generated.map((variant) => explicit.get(variant.id) ?? variant),
              ...variants.filter((variant) => !generatedIDs.has(variant.id)),
            ]
          })
        }
      }
    })
  }),
})

export function generate(
  model: { readonly id: string; readonly modelID?: string; readonly package?: string },
  provider?: { readonly package: string },
): NonNullable<Model.Info["variants"]> {
  const packageName = model.package ?? provider?.package
  if (!Provider.isAISDK(packageName) || Provider.packageName(packageName) !== "@ai-sdk/openai-compatible") return []
  const ids = `${model.id} ${model.modelID ?? ""}`.toLowerCase()
  if (!["glm-5.2", "glm-5-2", "glm-5p2"].some((name) => ids.includes(name))) return []
  return ["high", "max"].map((id) => ({
    id: Model.VariantID.make(id),
    settings: { reasoningEffort: id },
  }))
}
