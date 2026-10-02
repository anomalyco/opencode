import type { ProviderPackage } from "../../provider-package.js"
import { Cohere } from "../cohere.js"

export type Settings = Cohere.Settings<Cohere.ChatOptionsInput>

export const model: ProviderPackage.Definition<Settings, Cohere.ChatOptionsInput>["model"] = (
  modelID,
  { apiKey, baseURL, body, headers, ...providerOptions },
) =>
  Cohere.configure({
    apiKey,
    baseURL,
    headers,
    http: body === undefined ? undefined : { body: { ...body } },
    providerOptions,
  }).chat(modelID)
