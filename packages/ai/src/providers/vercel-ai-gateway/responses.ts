import type { ProviderPackage } from "../../provider-package.js"
import { vercelAIGateway, type ProviderOptionsInput, type Settings } from "../vercel-ai-gateway.js"
import { config } from "../vercel-ai-gateway-settings.js"

export type { Settings } from "../vercel-ai-gateway.js"

export const model: ProviderPackage.Model<Settings, ProviderOptionsInput> = (modelID, settings) =>
  vercelAIGateway.configure(config(settings)).responses(modelID)
