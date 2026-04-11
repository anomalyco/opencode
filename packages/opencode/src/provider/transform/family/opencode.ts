import type { Transform } from "../types"

export const options: Transform["options"] = (input) => {
  const result: Record<string, any> = {}

  if (["kimi-k2-thinking", "glm-4.6"].includes(input.model.api.id)) {
    result.chat_template_args = { enable_thinking: true }
  }

  if (input.model.api.id.includes("gpt-5") && !input.model.api.id.includes("gpt-5-chat")) {
    result.promptCacheKey = input.sessionID
    result.include = ["reasoning.encrypted_content"]
    result.reasoningSummary = "auto"
  }

  return result
}

export const variants: Transform["variants"] = () => {
  return {}
}

export const small: Transform["small"] = () => {
  return {}
}
