import type { ProviderPackage } from "../../provider-package.js"
import { minimax, type ResponsesOptionsInput, type ResponsesSettings } from "../minimax.js"

export type { ResponsesSettings as Settings } from "../minimax.js"

export const model: ProviderPackage.Model<ResponsesSettings, ResponsesOptionsInput> = (
  modelID,
  { apiKey, baseURL, body, headers, ...providerOptions }: ResponsesSettings = {},
) =>
  minimax
    .configure({
      apiKey,
      baseURL,
      headers,
      http: body === undefined ? undefined : { body },
      providerOptions,
    })
    .responses(modelID)
