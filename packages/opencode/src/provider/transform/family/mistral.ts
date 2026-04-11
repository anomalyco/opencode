import { scrubMistral } from "../shared"
import type { Transform } from "../types"

export const options: Transform["options"] = () => {
  return {}
}

export const variants: Transform["variants"] = () => {
  return {}
}

export const small: Transform["small"] = () => {
  return {}
}

export const normalize: NonNullable<Transform["normalize"]> = (msgs) => {
  return scrubMistral(msgs)
}
