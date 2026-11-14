import type { ProviderPackage } from "../../provider-package.js"
import { MiniMax } from "../minimax.js"
import { toConfig } from "../settings.js"

export type Settings = MiniMax.Settings<MiniMax.ResponsesOptionsInput>

export const model: ProviderPackage.Model<Settings, MiniMax.ResponsesOptionsInput> = (modelID, settings) =>
  MiniMax.configure(toConfig(settings)).responses(modelID)
