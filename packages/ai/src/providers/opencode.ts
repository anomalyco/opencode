import {
  mergeTransport,
  ProviderID,
  type ModelID,
  type ProviderOptions,
  type TransportOptions,
} from "../schema/index.js"
import type { ProviderPackage } from "../provider-package.js"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import { SystemOne } from "../protocols/system-one.js"
import { toConfig } from "./settings.js"

export const id = ProviderID.make("opencode")
const baseURL = "https://opencode.ai/inference/systemone/v1"

export type Config = TransportOptions &
  ProviderAuthOption<"optional"> & {
    readonly baseURL?: string
  }

export type Settings = ProviderPackage.Settings & { readonly apiKey?: string | false }

export const configure = (input: Config = {}) => {
  const route = SystemOne.route.with({
    provider: id,
    providerMetadataKey: "opencode",
    endpoint: { baseURL: input.baseURL ?? baseURL },
    auth: AuthOptions.bearer(input, "OPENCODE_API_KEY"),
    // Zen forwards TypeSafe's image opt-in header; text-only requests are unchanged with it.
    ...mergeTransport({ headers: { "TypeSafe-Danger-Zone-Images": "true" } }, input),
  })
  const decision = (modelID: string | ModelID, providerOptions?: ProviderOptions) =>
    route.model({ id: modelID, providerOptions })
  return { id, decision, configure }
}

export const provider = configure()
export const decision = provider.decision

export const decisionModel = (modelID: string, settings?: Settings) => {
  const input = toConfig(settings)
  return configure(input).decision(modelID, input.providerOptions)
}

export * as OpenCode from "./opencode.js"
