import { Provider } from "../provider"
import { ProviderID, type ModelID } from "../schema"
import * as OpenAICompatibleChat from "../protocols/openai-compatible-chat"
import type { RouteDefaultsInput } from "../route/client"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options"
import { profiles, type OpenAICompatibleProfile } from "./openai-compatible-profile"

export const id = ProviderID.make("openai-compatible")

export type ModelOptions = RouteDefaultsInput &
  ProviderAuthOption<"optional"> & {
    readonly provider: string
    readonly baseURL: string
  }

type GenericModelOptions = RouteDefaultsInput &
  ProviderAuthOption<"optional"> & {
    readonly provider?: string
    readonly baseURL: string
  }

export type FamilyModelOptions = RouteDefaultsInput &
  ProviderAuthOption<"optional"> & {
    readonly baseURL?: string
  }

export const routes = [OpenAICompatibleChat.route]

export const model = (id: string | ModelID, options: ModelOptions) => {
  const { provider, baseURL, apiKey: _, auth: _auth, ...rest } = options
  return OpenAICompatibleChat.route
    .with({
      ...rest,
      provider,
      endpoint: { baseURL },
      auth: AuthOptions.bearer(options, []),
    })
    .model({ id, provider: ProviderID.make(provider) })
}

export const profileModel = (
  profile: OpenAICompatibleProfile,
  id: string | ModelID,
  options: FamilyModelOptions = {},
) =>
  model(id, {
    ...options,
    baseURL: options.baseURL ?? profile.baseURL,
    provider: profile.provider,
  })

const define = (profile: OpenAICompatibleProfile) =>
  Provider.make({
    id: ProviderID.make(profile.provider),
    model: (id: string | ModelID, options: FamilyModelOptions = {}) => profileModel(profile, id, options),
  })

export const provider = Provider.make({
  id,
  model: (id: string | ModelID, options: GenericModelOptions) => {
    const provider = options.provider ?? "openai-compatible"
    if ("auth" in options) {
      const { provider: _, ...rest } = options
      return model(id, { ...rest, provider })
    }
    const { provider: _, ...rest } = options
    return model(id, { ...rest, provider })
  },
})

export const baseten = define(profiles.baseten)
export const cerebras = define(profiles.cerebras)
export const deepinfra = define(profiles.deepinfra)
export const deepseek = define(profiles.deepseek)
export const fireworks = define(profiles.fireworks)
export const groq = define(profiles.groq)
export const togetherai = define(profiles.togetherai)
