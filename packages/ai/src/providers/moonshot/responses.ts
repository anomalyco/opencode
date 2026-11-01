import type { ProviderPackage } from "../../provider-package.js"
import { moonshot, type ResponsesOptionsInput, type ResponsesSettings } from "../moonshot.js"

export type { ResponsesSettings as Settings } from "../moonshot.js"

export const model: ProviderPackage.Model<ResponsesSettings, ResponsesOptionsInput> = (
  modelID,
  { apiKey, baseURL, body, headers, ...providerOptions }: ResponsesSettings = {},
) =>
  moonshot
    .configure({
      apiKey,
      baseURL,
      headers,
      http: body === undefined ? undefined : { body },
      providerOptions,
    })
    .responses(modelID)
