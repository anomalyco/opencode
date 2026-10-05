import type { ProviderPackage } from "../../provider-package.js"
import { AnthropicMessages } from "../../protocols/anthropic-messages.js"
import { DigitalOcean } from "../digitalocean.js"

export type Settings = DigitalOcean.Settings<AnthropicMessages.OptionsInput>

export const model: ProviderPackage.Definition<Settings, AnthropicMessages.OptionsInput>["model"] = (
  modelID,
  { apiKey, baseURL, body, headers, ...providerOptions },
) => DigitalOcean.configure({ apiKey, baseURL, headers, http: { body }, providerOptions }).messages(modelID)
