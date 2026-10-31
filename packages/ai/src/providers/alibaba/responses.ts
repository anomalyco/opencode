import type { ProviderPackage } from "../../provider-package.js"
import { alibaba, type ResponsesOptionsInput, type ResponsesSettings } from "../alibaba.js"
import { config } from "../alibaba-settings.js"

export type { ResponsesSettings as Settings } from "../alibaba.js"

export const model: ProviderPackage.Model<ResponsesSettings, ResponsesOptionsInput> = (modelID, settings) =>
  alibaba.configure(config(settings)).responses(modelID)
