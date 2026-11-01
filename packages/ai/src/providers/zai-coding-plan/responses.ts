import type { ProviderPackage } from "../../provider-package.js"
import { zaiCodingPlan, type ResponsesOptionsInput, type ResponsesSettings } from "../zai-coding-plan.js"

export type { ResponsesSettings as Settings } from "../zai-coding-plan.js"

export const model: ProviderPackage.Model<ResponsesSettings, ResponsesOptionsInput> = (
  modelID,
  { apiKey, baseURL, body, headers, ...providerOptions }: ResponsesSettings = {},
) =>
  zaiCodingPlan
    .configure({
      apiKey,
      baseURL,
      headers,
      http: body === undefined ? undefined : { body },
      providerOptions,
    })
    .responses(modelID)
