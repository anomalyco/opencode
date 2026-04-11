import { WIDELY_SUPPORTED_EFFORTS } from "../shared"
import type { Transform } from "../types"

export const options: Transform["options"] = () => {
  return {}
}

export const variants: Transform["variants"] = (model) => {
  if (!model.capabilities.reasoning) return {}
  return Object.fromEntries(
    ["none", ...WIDELY_SUPPORTED_EFFORTS].map((effort) => [effort, { reasoningEffort: effort }]),
  )
}

export const small: Transform["small"] = () => {
  return {}
}
