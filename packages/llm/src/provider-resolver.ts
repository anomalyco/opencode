import { ModelID, ProviderID, type Protocol } from "./schema"
import type { ModelID as ModelIDType, ProviderID as ProviderIDType } from "./schema"
import type { CapabilitiesInput } from "./llm"

export type ProviderAuth = "bearer" | "anthropic-api-key" | "google-api-key" | "none"

export interface ProviderResolution {
  readonly provider: ProviderIDType
  readonly protocol: Protocol
  readonly baseURL?: string
  readonly auth: ProviderAuth
  readonly capabilities?: CapabilitiesInput
}

export interface ProviderResolveInput {
  readonly modelID: ModelIDType
  readonly providerID: ProviderIDType
  readonly options: Record<string, unknown>
}

export interface ProviderResolver {
  readonly id: ProviderIDType
  readonly resolve: (input: ProviderResolveInput) => ProviderResolution | undefined
}

export const make = (
  provider: string | ProviderIDType,
  protocol: Protocol,
  options: Partial<Omit<ProviderResolution, "provider" | "protocol">> = {},
): ProviderResolution => ({
  provider: ProviderID.make(provider),
  protocol,
  auth: options.auth ?? "bearer",
  ...options,
})

export const define = (input: ProviderResolver): ProviderResolver => input

export const fixed = (
  provider: string | ProviderIDType,
  protocol: Protocol,
  options: Partial<Omit<ProviderResolution, "provider" | "protocol">> = {},
): ProviderResolver => {
  const resolution = make(provider, protocol, options)
  return define({ id: resolution.provider, resolve: () => resolution })
}

export const input = (
  modelID: string | ModelIDType,
  providerID: string | ProviderIDType,
  options: Record<string, unknown>,
): ProviderResolveInput => ({
  modelID: ModelID.make(modelID),
  providerID: ProviderID.make(providerID),
  options,
})

export * as ProviderResolver from "./provider-resolver"
