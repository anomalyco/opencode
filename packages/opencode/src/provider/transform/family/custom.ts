import type { Transform } from "../types"

export const options: Transform["options"] = (input) => {
  if (input.model.providerID === "baseten") {
    return {
      chat_template_args: { enable_thinking: true },
    }
  }
  return {}
}

export const variants: Transform["variants"] = () => {
  return {}
}

export const small: Transform["small"] = () => {
  return {}
}
