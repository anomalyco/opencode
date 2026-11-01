import type { ProviderPackage } from "../../provider-package.js"
import { moonshot, type MessagesOptionsInput, type MessagesSettings } from "../moonshot.js"

export type { MessagesSettings as Settings } from "../moonshot.js"

export const model: ProviderPackage.Model<MessagesSettings, MessagesOptionsInput> = (
  modelID,
  { apiKey, baseURL, body, headers, ...providerOptions }: MessagesSettings = {},
) =>
  moonshot
    .configure({
      apiKey,
      baseURL,
      headers,
      http: body === undefined ? undefined : { body },
      providerOptions,
    })
    .messages(modelID)
