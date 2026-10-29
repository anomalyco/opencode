import type { ProviderPackage } from "../../provider-package.js"
import { Cohere } from "../cohere.js"

export type Settings = Cohere.Settings<Cohere.ChatOptionsInput>

export const model: ProviderPackage.Model<Settings, Cohere.ChatOptionsInput> = (
  modelID,
  { apiKey, baseURL, body, headers, ...providerOptions }: Settings = {},
) =>
  Cohere.configure({
    apiKey,
    baseURL,
    headers,
    http: body === undefined ? undefined : { body },
    providerOptions,
  }).chat(modelID)
