export * as ConfigModel from "./model"

import { Schema, SchemaGetter } from "effect"
import { Model } from "@opencode-ai/schema/model"
import { Provider } from "@opencode-ai/schema/provider"

const ProviderID = Provider.ID.check(Schema.isPattern(/^[^/#]+$/))
const ModelID = Model.ID.check(Schema.isPattern(/^[^#]+$/))
const VariantID = Model.VariantID.check(Schema.isPattern(/^[^#]+$/))

const Explicit = Schema.Struct({
  providerID: ProviderID,
  model: ModelID,
  variant: VariantID.pipe(Schema.optional),
})

const Short = Schema.String.check(Schema.isPattern(/^[^/#]+\/[^#]+(?:#[^#]+)?$/))

export interface Selection extends Schema.Schema.Type<typeof Explicit> {}
export const Selection = Schema.Union([Short, Explicit])
  .pipe(
    Schema.decodeTo(Explicit, {
      decode: SchemaGetter.transform((input) => (typeof input === "string" ? parse(input) : input)),
      encode: SchemaGetter.passthrough({ strict: false }),
    }),
  )
  .annotate({ identifier: "Config.ModelSelection" })

function parse(input: string): Selection {
  const ref = Model.Ref.parse(input)
  return {
    providerID: ref.providerID,
    model: ref.id,
    ...(ref.variant ? { variant: ref.variant } : {}),
  }
}
