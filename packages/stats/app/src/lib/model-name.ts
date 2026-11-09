import { statModel } from "@opencode/stats-core/domain/model-normalization"

const glmFlashModel = "glm-5.3-flash"

// The public name of a model that has stats but no catalog entry, such as a stealth model.
export function publicModelName(model: string) {
  if (model === "unknown") return undefined
  if (model === glmFlashModel) return "GLM-5.3-Flash"
  return model
}

export function formerModelName(model: string) {
  return statModel(model, undefined) === glmFlashModel ? "ox-alpha" : undefined
}
