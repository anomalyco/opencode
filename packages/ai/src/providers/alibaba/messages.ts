import type { ProviderPackage } from "../../provider-package.js"
import { alibaba, type MessagesOptionsInput, type MessagesSettings } from "../alibaba.js"
import { config } from "../alibaba-settings.js"

export type { MessagesSettings as Settings } from "../alibaba.js"

export const model: ProviderPackage.Model<MessagesSettings, MessagesOptionsInput> = (modelID, settings) =>
  alibaba.configure(config(settings)).messages(modelID)
