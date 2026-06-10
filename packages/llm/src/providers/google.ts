import type { RouteDefaultsInput } from "../route/client"
import { Auth } from "../route/auth"
import type { ProviderAuthOption } from "../route/auth-options"
import { ProviderID, type ModelID } from "../schema"
import * as Gemini from "../protocols/gemini"

export const id = ProviderID.make("google")

export const routes = [Gemini.route]

export type Config = RouteDefaultsInput & ProviderAuthOption<"optional"> & { readonly baseURL?: string }

const auth = (options: ProviderAuthOption<"optional">) => {
  if ("auth" in options && options.auth) return options.auth
  const apiKey = "apiKey" in options ? options.apiKey : undefined
  const base = Array.isArray(apiKey)
    ? Auth.pool(apiKey, "apiKey")
    : Auth.optional(apiKey as Exclude<typeof apiKey, readonly string[]>, "apiKey")
  return base.orElse(Auth.config("GOOGLE_GENERATIVE_AI_API_KEY")).pipe(Auth.header("x-goog-api-key"))
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
export const model = provider.model
