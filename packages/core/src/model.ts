import { Model } from "@opencode-ai/schema/model"
import { ProviderV2 } from "./provider"
import type { DeepMutable } from "./schema"

export const ID = Model.ID
export type ID = typeof ID.Type

export const VariantID = Model.VariantID
export type VariantID = typeof VariantID.Type

// Grouping of models, eg claude opus, claude sonnet
export const Family = Model.Family
export type Family = Model.Family

export const ReasoningField = Model.ReasoningField
export type ReasoningField = Model.ReasoningField

export const Compatibility = Model.Compatibility
export type Compatibility = Model.Compatibility

export const Capabilities = Model.Capabilities
export type Capabilities = Model.Capabilities

export const Cost = Model.Cost

export const Ref = Model.Ref
export type Ref = typeof Ref.Type

export const Info = Model.Info
export type Info = Model.Info

export type MutableInfo = DeepMutable<Info>

export function compatibility(input: unknown): Compatibility | undefined {
  if (typeof input === "string") return { reasoningField: input }
  if (typeof input !== "object" || input === null || Array.isArray(input) || !("field" in input)) return undefined
  return typeof input.field === "string" ? { reasoningField: input.field } : undefined
}

export function parse(input: string): { providerID: ProviderV2.ID; modelID: ID } {
  const [providerID, ...modelID] = input.split("/")
  return {
    providerID: ProviderV2.ID.make(providerID),
    modelID: ID.make(modelID.join("/")),
  }
}

export * as ModelV2 from "./model"
