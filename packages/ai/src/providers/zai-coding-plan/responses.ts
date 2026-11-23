import type { ProviderPackage } from "../../provider-package.js"
import { ZAICodingPlan } from "../zai-coding-plan.js"
import { toConfig } from "../settings.js"

export type Settings = ZAICodingPlan.Settings<ZAICodingPlan.ResponsesOptionsInput>

export const model: ProviderPackage.Model<Settings, ZAICodingPlan.ResponsesOptionsInput> = (modelID, settings) =>
  ZAICodingPlan.configure(toConfig(settings)).responses(modelID)
