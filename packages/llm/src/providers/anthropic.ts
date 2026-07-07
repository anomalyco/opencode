import type { RouteDefaultsInput } from "../route/client"
import { Auth } from "../route/auth"
import type { ProviderAuthOption } from "../route/auth-options"
import type { ProviderPackage } from "../provider-package"
import { ProviderID, type ModelID } from "../schema"
import * as AnthropicMessages from "../protocols/anthropic-messages"

export const id = ProviderID.make("anthropic")

export const routes = [AnthropicMessages.route]

export type Config = RouteDefaultsInput & ProviderAuthOption<"optional"> & { readonly baseURL?: string }

export interface Settings extends ProviderPackage.Settings {
  readonly apiKey?: string
  readonly authToken?: string
  readonly baseURL?: string
}

const auth = (options: ProviderAuthOption<"optional">) => {
  if ("auth" in options && options.auth) return options.auth
  return Auth.optional("apiKey" in options ? options.apiKey : undefined, "apiKey")
    .orElse(Auth.config("ANTHROPIC_API_KEY"))
    .pipe(Auth.header("x-api-key"))
}

const configuredRoute = (input: Config) => {
  const { apiKey: _, auth: _auth, baseURL, ...rest } = input
  return AnthropicMessages.route.with({ ...rest, endpoint: { baseURL }, auth: auth(input) })
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
    ...(settings.authToken === undefined ? { apiKey: settings.apiKey } : { auth: Auth.bearer(settings.authToken) }),
    baseURL: settings.baseURL,
    headers: settings.headers === undefined ? undefined : { ...settings.headers },
    http: settings.body === undefined ? undefined : { body: { ...settings.body } },
    limits: settings.limits,
  }).model(modelID)
