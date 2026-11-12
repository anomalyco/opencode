import type { ProviderPackage } from "../../provider-package.js"
import { MiniMax } from "../minimax.js"
import { toConfig } from "../settings.js"

export type Settings = MiniMax.Settings<MiniMax.ChatOptionsInput>

export const model: ProviderPackage.Model<Settings, MiniMax.ChatOptionsInput> = (modelID, settings) =>
  MiniMax.configure(toConfig(settings)).chat(modelID)
