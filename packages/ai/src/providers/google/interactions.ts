import { configure } from "../google.js"
import type { ProviderPackage } from "../../provider-package.js"
import type { GoogleInteractions } from "../../protocols/google-interactions.js"

export type Settings = ProviderPackage.Settings &
  GoogleInteractions.ProviderOptionsInput & {
    readonly apiKey?: string
    readonly baseURL?: string
  }

export const model: ProviderPackage.Model<Settings, GoogleInteractions.ProviderOptionsInput> = (
  modelID,
  { apiKey, baseURL, body, headers, ...providerOptions }: Settings = {},
) =>
  configure({
    apiKey,
    baseURL,
    headers,
    http: body === undefined ? undefined : { body },
    providerOptions,
  }).interactions(modelID)
