import { ModelID, ProviderID, type Protocol } from "./schema"
import type { ModelID as ModelIDType, ProviderID as ProviderIDType } from "./schema"

export interface ProviderRoute {
  readonly provider: ProviderIDType
  readonly protocol: Protocol
}

export interface ProviderRouteInput {
  readonly modelID: ModelIDType
  readonly providerID: ProviderIDType
  readonly options: Record<string, unknown>
}

export interface ProviderDefinition {
  readonly id: ProviderIDType
  readonly route: (input: ProviderRouteInput) => ProviderRoute | undefined
}

export const make = (provider: string | ProviderIDType, protocol: Protocol): ProviderRoute => ({
  provider: ProviderID.make(provider),
  protocol,
})

export const define = (input: ProviderDefinition): ProviderDefinition => input

export const fixed = (provider: string | ProviderIDType, protocol: Protocol): ProviderDefinition => {
  const route = make(provider, protocol)
  return define({ id: route.provider, route: () => route })
}

export const input = (
  modelID: string | ModelIDType,
  providerID: string | ProviderIDType,
  options: Record<string, unknown>,
): ProviderRouteInput => ({
  modelID: ModelID.make(modelID),
  providerID: ProviderID.make(providerID),
  options,
})

export * as ProviderRoute from "./provider-route"
