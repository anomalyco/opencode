import type { ProviderPackage } from "../../provider-package.js"
import { Moonshot } from "../moonshot.js"

export type Settings = Moonshot.Settings<Moonshot.ResponsesOptionsInput>

export const model: ProviderPackage.Model<Settings, Moonshot.ResponsesOptionsInput> = (
  modelID,
  { apiKey, baseURL, body, headers, ...providerOptions }: Settings = {},
) =>
  Moonshot.configure({
    apiKey,
    baseURL,
    headers,
    http: body === undefined ? undefined : { body },
    providerOptions,
  }).responses(modelID)
