import type { ProviderPackage } from "../../provider-package.js"
import { ZAICodingPlan } from "../zai-coding-plan.js"

export type Settings = ZAICodingPlan.Settings<ZAICodingPlan.MessagesOptionsInput>

export const model: ProviderPackage.Definition<Settings, ZAICodingPlan.MessagesOptionsInput>["model"] = (
  modelID,
  settings,
) =>
  ZAICodingPlan.configure({
    apiKey: settings.apiKey,
    baseURL: settings.baseURL,
    headers: settings.headers,
    http: settings.body === undefined ? undefined : { body: { ...settings.body } },
    providerOptions: settings.providerOptions,
  }).messages(modelID)
