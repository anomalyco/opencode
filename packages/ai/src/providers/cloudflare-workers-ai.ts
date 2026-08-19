import type { ProviderPackage } from "../provider-package"
import type { OpenAIProviderOptionsInput } from "./openai-options"
import { CloudflareWorkersAI } from "./cloudflare"

export interface Settings extends ProviderPackage.Settings {
  readonly accountId?: string
  readonly apiKey?: string
  readonly providerOptions?: OpenAIProviderOptionsInput
}

export const model: ProviderPackage.Definition<Settings>["model"] = (modelID, settings) =>
  CloudflareWorkersAI.configure({
    ...(typeof settings.baseURL === "string" ? { baseURL: settings.baseURL } : { accountId: settings.accountId ?? "" }),
    apiKey: settings.apiKey,
    headers: settings.headers === undefined ? undefined : { ...settings.headers },
    http: settings.body === undefined ? undefined : { body: { ...settings.body } },
    limits: settings.limits,
    providerOptions: settings.providerOptions,
  }).model(modelID)
