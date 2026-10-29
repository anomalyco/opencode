import type { ProviderPackage } from "../../provider-package.js"
import { MiniMax } from "../minimax.js"

export type Settings = MiniMax.Settings<MiniMax.ResponsesOptionsInput>

export const model: ProviderPackage.Model<Settings, MiniMax.ResponsesOptionsInput> = (
  modelID,
  { apiKey, baseURL, body, headers, ...providerOptions }: Settings = {},
) =>
  MiniMax.configure({
    apiKey,
    baseURL,
    headers,
    http: body === undefined ? undefined : { body },
    providerOptions,
  }).responses(modelID)
