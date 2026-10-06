import { configure } from "../google.js"
import type { ProviderPackage } from "../../provider-package.js"
import type { GoogleInteractions } from "../../protocols/google-interactions.js"

export type Settings = ProviderPackage.Settings &
  GoogleInteractions.ProviderOptionsInput & {
    readonly apiKey?: string
    readonly baseURL?: string
  }

export const model: ProviderPackage.Definition<Settings, GoogleInteractions.ProviderOptionsInput>["model"] = (
  modelID,
  { apiKey, baseURL, body, headers, ...providerOptions },
) =>
  configure({
    apiKey,
    baseURL,
    headers: headers === undefined ? undefined : { ...headers },
    http: body === undefined ? undefined : { body: { ...body } },
    providerOptions,
  }).interactions(modelID)
