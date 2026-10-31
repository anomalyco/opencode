import type { ProviderPackage } from "../../provider-package.js"
import { zaiCodingPlan, type MessagesOptionsInput, type MessagesSettings } from "../zai-coding-plan.js"

export type { MessagesSettings as Settings } from "../zai-coding-plan.js"

export const model: ProviderPackage.Model<MessagesSettings, MessagesOptionsInput> = (
  modelID,
  { apiKey, baseURL, body, headers, ...providerOptions }: MessagesSettings = {},
) =>
  zaiCodingPlan
    .configure({
      apiKey,
      baseURL,
      headers,
      http: body === undefined ? undefined : { body },
      providerOptions,
    })
    .messages(modelID)
