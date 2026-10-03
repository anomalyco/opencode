import type { LLMRequest } from "../../schema/index.js"
import { ModelNames } from "../../model-names.js"

export const THINKING_BINDING_BETA = "thinking-binding-controls-2026-08-01"

export const claudeVersion = ModelNames.claudeVersion

export const supportsThinkingBlockBinding = (model: LLMRequest["model"]) => {
  const override = model.compatibility?.supportsThinkingBlockBinding
  if (override !== undefined) return override
  const version = claudeVersion(model.id)
  return version !== undefined && (version.major > 5 || (version.major === 5 && version.minor >= 1))
}
