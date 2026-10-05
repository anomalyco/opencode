import type { ProviderPackage } from "../../provider-package.js"
import { DigitalOcean } from "../digitalocean.js"
import type { OpenAIProviderOptionsInput } from "../openai-options.js"

export type Settings = DigitalOcean.Settings<OpenAIProviderOptionsInput>

export const model: ProviderPackage.Definition<Settings, OpenAIProviderOptionsInput>["model"] = (
  modelID,
  { apiKey, baseURL, body, headers, ...providerOptions },
) => DigitalOcean.configure({ apiKey, baseURL, headers, http: { body }, providerOptions }).chat(modelID)
