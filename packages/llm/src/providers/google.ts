import type { RouteDefaultsInput } from "../route/client"
import { Auth } from "../route/auth"
import type { ProviderAuthOption } from "../route/auth-options"
import type { ProviderPackage } from "../provider-package"
import { ProviderID, type ModelID, type ProviderOptions } from "../schema"
import * as Gemini from "../protocols/gemini"

export const id = ProviderID.make("google")

export const routes = [Gemini.route]

export type Config = RouteDefaultsInput & ProviderAuthOption<"optional"> & { readonly baseURL?: string }

export interface Settings extends ProviderPackage.Settings {
  readonly apiKey?: string
  readonly baseURL?: string
  readonly providerOptions?: ProviderOptions
}

const auth = (options: ProviderAuthOption<"optional">) => {
  if ("auth" in options && options.auth) return options.auth
  return Auth.optional("apiKey" in options ? options.apiKey : undefined, "apiKey")
    .orElse(Auth.config("GOOGLE_GENERATIVE_AI_API_KEY"))
    .pipe(Auth.header("x-goog-api-key"))
}

const configuredRoute = (input: Config) => {
  const { apiKey: _, auth: _auth, baseURL, ...rest } = input
  return Gemini.route.with({ ...rest, endpoint: { baseURL }, auth: auth(input) })
}

export const configure = (input: Config = {}) => {
  const route = configuredRoute(input)
  return {
    id,
    model: (modelID: string | ModelID) => route.model({ id: modelID }),
    configure,
  }
}

export const provider = configure()
export const model: ProviderPackage.Definition<Settings>["model"] = (modelID, settings) =>
  configure({
    apiKey: settings.apiKey,
    baseURL: settings.baseURL,
    headers: settings.headers === undefined ? undefined : { ...settings.headers },
    http: settings.body === undefined ? undefined : { body: { ...settings.body } },
    limits: settings.limits,
    providerOptions: settings.providerOptions,
  }).model(modelID)
