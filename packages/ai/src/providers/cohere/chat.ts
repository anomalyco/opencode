import type { ProviderPackage } from "../../provider-package.js"
import { cohere, type ChatOptionsInput, type ChatSettings } from "../cohere.js"

export type { ChatSettings as Settings } from "../cohere.js"

export const model: ProviderPackage.Model<ChatSettings, ChatOptionsInput> = (
  modelID,
  { apiKey, baseURL, body, headers, ...providerOptions }: ChatSettings = {},
) =>
  cohere
    .configure({
      apiKey,
      baseURL,
      headers,
      http: body === undefined ? undefined : { body },
      providerOptions,
    })
    .chat(modelID)
