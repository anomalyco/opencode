import type { ProviderPackage } from "../../provider-package.js"
import { ZAICodingPlan } from "../zai-coding-plan.js"

export type Settings = ZAICodingPlan.Settings<ZAICodingPlan.MessagesOptionsInput>

export const model: ProviderPackage.Model<Settings, ZAICodingPlan.MessagesOptionsInput> = (
  modelID,
  { apiKey, baseURL, body, headers, ...providerOptions }: Settings = {},
) =>
  ZAICodingPlan.configure({
    apiKey,
    baseURL,
    headers,
    http: body === undefined ? undefined : { body },
    providerOptions,
  }).messages(modelID)
