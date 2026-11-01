import type { ProviderPackage } from "../../provider-package.js"
import type { OpenResponsesProviderOptionsInput } from "../open-responses-options.js"
import { digitalocean, type ResponsesSettings } from "../digitalocean.js"
import { config } from "../digitalocean-settings.js"

export type { ResponsesSettings as Settings } from "../digitalocean.js"

export const model: ProviderPackage.Model<ResponsesSettings, OpenResponsesProviderOptionsInput> = (modelID, settings) =>
  digitalocean.configure(config(settings)).responses(modelID)
