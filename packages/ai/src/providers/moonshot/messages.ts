import type { ProviderPackage } from "../../provider-package.js"
import { Moonshot } from "../moonshot.js"

export type Settings = Moonshot.Settings<Moonshot.MessagesOptionsInput>

export const model: ProviderPackage.Definition<Settings, Moonshot.MessagesOptionsInput>["model"] = (
  modelID,
  settings,
) =>
  Moonshot.configure({
    apiKey: settings.apiKey,
    baseURL: settings.baseURL,
    headers: settings.headers,
    http: settings.body === undefined ? undefined : { body: { ...settings.body } },
    providerOptions: settings.providerOptions,
  }).messages(modelID)
