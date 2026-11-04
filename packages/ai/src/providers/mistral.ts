import type { ProviderPackage } from "../provider-package.js"
import { MistralChat } from "../protocols/mistral-chat.js"
import type { ProviderAuthOption } from "../route/auth-options.js"
import type { RouteDefaultsInput } from "../route/client.js"
import { ProviderID, type ModelID } from "../schema/index.js"
import { bearerRouteDefaults, toConfig } from "./settings.js"

export const id = ProviderID.make("mistral")

export type ProviderOptions = MistralChat.ProviderOptionsInput

export type Config = Omit<RouteDefaultsInput, "providerOptions"> &
  ProviderAuthOption<"optional"> & {
    readonly baseURL?: string
    readonly providerOptions?: ProviderOptions
  }

export type Settings = ProviderPackage.Settings &
  ProviderOptions & {
    readonly apiKey?: string | false
    readonly baseURL?: string
  }

export const route = MistralChat.route
export const routes = [route]

export const configure = (input: Config = {}) => {
  const configured = route.with(bearerRouteDefaults(input, "MISTRAL_API_KEY", MistralChat.DEFAULT_BASE_URL))
  return {
    id,
    model: (modelID: string | ModelID) => configured.model<ProviderOptions>({ id: modelID }),
    configure,
  }
}

export const provider = configure()

export const model: ProviderPackage.Model<Settings, ProviderOptions> = (modelID, settings) =>
  configure(toConfig(settings)).model(modelID)

export * as Mistral from "./mistral.js"
