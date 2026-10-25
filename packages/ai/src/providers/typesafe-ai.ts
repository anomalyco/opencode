import { HttpOptions, ProviderID, type ModelID } from "../schema/index.js"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import { SystemOne } from "../protocols/system-one.js"

export const id = ProviderID.make("typesafe-ai")
const baseURL = "https://api.typesafe.ai/v1"

export type Options = ProviderAuthOption<"optional"> & {
  readonly baseURL?: string
  readonly headers?: Record<string, string>
  readonly http?: HttpOptions.Input
}

export const configure = (input: Options = {}) => {
  const route = SystemOne.route.with({
    provider: id,
    providerMetadataKey: "typesafe",
    endpoint: { baseURL: input.baseURL ?? baseURL },
    auth: AuthOptions.bearer(input, "TYPESAFE_API_KEY"),
    // Required for images; text-only requests are unchanged with it.
    headers: { "TypeSafe-Danger-Zone-Images": "true", ...input.headers },
    http: input.http,
  })
  const decision = (modelID: string | ModelID) => route.model({ id: modelID })
  return { id, decision, configure }
}

export const provider = configure()
export const decision = provider.decision

export * as TypeSafeAI from "./typesafe-ai.js"
