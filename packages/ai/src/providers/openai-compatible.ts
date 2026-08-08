import { HttpOptions, ProviderID, mergeHttpOptions, type ModelID } from "../schema"
import * as OpenAICompatibleChat from "../protocols/openai-compatible-chat"
import type { RouteDefaultsInput } from "../route/client"
import { Auth } from "../route/auth"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options"
import type { ProviderPackage } from "../provider-package"
import { profiles, type OpenAICompatibleProfile } from "./openai-compatible-profile"
import type { OpenAIProviderOptionsInput } from "./openai-options"

export const id = ProviderID.make("openai-compatible")

type GenericModelOptions = Omit<RouteDefaultsInput, "providerOptions"> &
  ProviderAuthOption<"optional"> & {
    readonly provider?: string
    readonly baseURL: string
    readonly providerOptions?: OpenAIProviderOptionsInput
  }

export interface Settings extends ProviderPackage.Settings {
  readonly apiKey?: string
  readonly baseURL: string
  readonly provider?: string
  readonly http?: RouteDefaultsInput["http"]
  readonly providerOptions?: OpenAIProviderOptionsInput
}

export type FamilyModelOptions = Omit<RouteDefaultsInput, "providerOptions"> &
  ProviderAuthOption<"optional"> & {
    readonly baseURL?: string
    readonly providerOptions?: OpenAIProviderOptionsInput
  }

export const routes = [OpenAICompatibleChat.route]

export const configure = (input: GenericModelOptions) => {
  const provider = input.provider ?? "openai-compatible"
  const {
    provider: _,
    baseURL,
    apiKey: _apiKey,
    auth: _auth,
    headers,
    ...rest
  } = input
  const route = OpenAICompatibleChat.route.with({
    ...rest,
    provider,
    endpoint: { baseURL },
    auth: AuthOptions.bearer(input, []).andThen(Auth.headers(headers ?? {})),
  })
  return {
    id: ProviderID.make(provider),
    model: (modelID: string | ModelID) =>
      // oxlint-disable-next-line typescript-eslint/no-unnecessary-type-arguments -- preserves provider-option validation at call sites
      route.model<OpenAIProviderOptionsInput>({ id: modelID, provider: ProviderID.make(provider) }),
    configure,
  }
}

const define = (profile: OpenAICompatibleProfile) => {
  const configureProfile = (input: FamilyModelOptions = {}) => {
    const facade = configure({
      ...input,
      baseURL: input.baseURL ?? profile.baseURL,
      provider: profile.provider,
    })
    return {
      id: ProviderID.make(profile.provider),
      model: facade.model,
      configure: configureProfile,
    }
  }
  return configureProfile()
}

export const provider = {
  id,
  configure,
}

export const model: ProviderPackage.Definition<Settings>["model"] = (modelID, settings) =>
  configure({
    apiKey: settings.apiKey,
    baseURL: settings.baseURL,
    headers: settings.headers === undefined ? undefined : { ...settings.headers },
    http: mergeHttpOptions(
      settings.http === undefined ? undefined : HttpOptions.make(settings.http),
      settings.body === undefined ? undefined : new HttpOptions({ body: { ...settings.body } }),
    ),
    limits: settings.limits,
    provider: settings.provider,
    providerOptions: settings.providerOptions,
  }).model(modelID)

export const baseten = define(profiles.baseten)
export const cerebras = define(profiles.cerebras)
export const deepinfra = define(profiles.deepinfra)
export const deepseek = define(profiles.deepseek)
export const fireworks = define(profiles.fireworks)
export const groq = define(profiles.groq)
export const togetherai = define(profiles.togetherai)
