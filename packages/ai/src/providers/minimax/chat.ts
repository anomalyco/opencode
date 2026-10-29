import type { ProviderPackage } from "../../provider-package.js"
import { MiniMax } from "../minimax.js"

export type Settings = MiniMax.Settings<MiniMax.ChatOptionsInput>

export const model: ProviderPackage.Model<Settings, MiniMax.ChatOptionsInput> = (
  modelID,
  { apiKey, baseURL, body, headers, ...providerOptions }: Settings = {},
) =>
  MiniMax.configure({
    apiKey,
    baseURL,
    headers,
    http: body === undefined ? undefined : { body },
    providerOptions,
  }).chat(modelID)
