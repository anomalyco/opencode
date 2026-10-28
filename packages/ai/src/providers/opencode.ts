import { HttpOptions, ProviderID, type ModelID, type ProviderOptions } from "../schema/index.js"
import type { ProviderPackage } from "../provider-package.js"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import { SystemOne } from "../protocols/system-one.js"

export const id = ProviderID.make("opencode")
const baseURL = "https://opencode.ai/inference/systemone/v1"

export type Config = ProviderAuthOption<"optional"> & {
  readonly baseURL?: string
  readonly headers?: Record<string, string>
  readonly http?: HttpOptions.Input
}

export type Settings = ProviderPackage.Settings & { readonly apiKey?: string }

export const configure = (input: Config = {}) => {
  const route = SystemOne.route.with({
    provider: id,
    providerMetadataKey: "opencode",
    endpoint: { baseURL: input.baseURL ?? baseURL },
    auth: AuthOptions.bearer(input, "OPENCODE_API_KEY"),
    // Zen forwards TypeSafe's image opt-in header; text-only requests are unchanged with it.
    headers: { "TypeSafe-Danger-Zone-Images": "true", ...input.headers },
    http: input.http,
  })
  const decision = (modelID: string | ModelID, providerOptions?: ProviderOptions) =>
    route.model({ id: modelID, providerOptions })
  return { id, decision, configure }
}

export const provider = configure()
export const decision = provider.decision

export const decisionModel = (modelID: string, { apiKey, baseURL, body, headers, ...providerOptions }: Settings = {}) =>
  configure({ apiKey, baseURL, headers, http: body === undefined ? undefined : { body } }).decision(
    modelID,
    providerOptions,
  )

export * as OpenCode from "./opencode.js"
