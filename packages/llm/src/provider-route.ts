import type { Protocol } from "./schema"

export interface ProviderRoute {
  readonly provider: string
  readonly protocol: Protocol
}

export interface ProviderRouteInput {
  readonly modelID: string
  readonly providerID: string
  readonly options: Record<string, unknown>
}

export interface ProviderDefinition {
  readonly id: string
  readonly route: (input: ProviderRouteInput) => ProviderRoute | undefined
}

export const make = (provider: string, protocol: Protocol): ProviderRoute => ({ provider, protocol })

export const define = (input: ProviderDefinition): ProviderDefinition => input

export const fixed = (provider: string, protocol: Protocol): ProviderDefinition => {
  const route = make(provider, protocol)
  return define({ id: provider, route: () => route })
}

export * as ProviderRoute from "./provider-route"
