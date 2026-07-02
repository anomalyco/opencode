import { Types } from "effect"
import { Model } from "@opencode-ai/schema/model"
import { ProviderV2 } from "./provider"

export const ID = Model.ID
export type ID = typeof ID.Type

export const VariantID = Model.VariantID
export type VariantID = typeof VariantID.Type

// Grouping of models, eg claude opus, claude sonnet
export const Family = Model.Family
export type Family = Model.Family

export const Capabilities = Model.Capabilities
export type Capabilities = Model.Capabilities

export const Cost = Model.Cost

export const Ref = Model.Ref
export type Ref = typeof Ref.Type

export const Api = Model.Api
export type Api = Model.Api

export const Info = Model.Info
export type Info = Model.Info

export type MutableRequest = ProviderV2.MutableRequest & { variant?: string }
export type MutableVariant = ProviderV2.MutableRequest & { id: VariantID }

export type MutableInfo = Omit<Types.DeepMutable<Info>, "api" | "request" | "variants"> & {
  api: ProviderV2.MutableApi<Api>
  request: MutableRequest
  variants: MutableVariant[]
}

export function parse(input: string): { providerID: ProviderV2.ID; modelID: ID } {
  const [providerID, ...modelID] = input.split("/")
  return {
    providerID: ProviderV2.ID.make(providerID),
    modelID: ID.make(modelID.join("/")),
  }
}

export * as ModelV2 from "./model"
