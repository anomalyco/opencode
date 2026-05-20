import type { RouteDefaultsInput } from "../route/client"
import { Provider } from "../provider"
import { Auth } from "../route/auth"
import type { ProviderAuthOption } from "../route/auth-options"
import { ProviderID, type ModelID } from "../schema"
import * as Gemini from "../protocols/gemini"

export const id = ProviderID.make("google")

export const routes = [Gemini.route]

type ModelOptions = RouteDefaultsInput & ProviderAuthOption<"optional"> & { readonly baseURL?: string }

const auth = (options: ProviderAuthOption<"optional">) => {
  if ("auth" in options && options.auth) return options.auth
  return Auth.optional("apiKey" in options ? options.apiKey : undefined, "apiKey")
    .orElse(Auth.config("GOOGLE_GENERATIVE_AI_API_KEY"))
    .pipe(Auth.header("x-goog-api-key"))
}

export const model = (id: string | ModelID, options: ModelOptions = {}) => {
  const { apiKey: _, auth: _auth, baseURL, ...rest } = options
  return Gemini.route.with({ ...rest, endpoint: { baseURL }, auth: auth(options) }).model({ id })
}

export const provider = Provider.make({
  id,
  model,
})
