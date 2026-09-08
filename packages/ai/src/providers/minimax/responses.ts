import type { ProviderPackage } from "../../provider-package.js"
import { MiniMax } from "../minimax.js"

export type Settings = MiniMax.Settings<MiniMax.ResponsesOptionsInput>

export const model: ProviderPackage.Definition<Settings, MiniMax.ResponsesOptionsInput>["model"] = (
  modelID,
  settings,
) =>
  MiniMax.configure({
    apiKey: settings.apiKey,
    baseURL: settings.baseURL,
    headers: settings.headers,
    http: settings.body === undefined ? undefined : { body: { ...settings.body } },
    providerOptions: settings.providerOptions,
  }).responses(modelID)
