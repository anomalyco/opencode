import type { ProviderPackage } from "../../provider-package.js"
import { minimax, type ChatOptionsInput, type ChatSettings } from "../minimax.js"

export type { ChatSettings as Settings } from "../minimax.js"

export const model: ProviderPackage.Model<ChatSettings, ChatOptionsInput> = (
  modelID,
  { apiKey, baseURL, body, headers, ...providerOptions }: ChatSettings = {},
) =>
  minimax
    .configure({
      apiKey,
      baseURL,
      headers,
      http: body === undefined ? undefined : { body },
      providerOptions,
    })
    .chat(modelID)
