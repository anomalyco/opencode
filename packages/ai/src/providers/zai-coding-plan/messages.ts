import type { ProviderPackage } from "../../provider-package.js"
import { ZAICodingPlan } from "../zai-coding-plan.js"
import { toConfig } from "../settings.js"

export type Settings = ZAICodingPlan.Settings<ZAICodingPlan.MessagesOptionsInput>

export const model: ProviderPackage.Model<Settings, ZAICodingPlan.MessagesOptionsInput> = (modelID, settings) =>
  ZAICodingPlan.configure(toConfig(settings)).messages(modelID)
