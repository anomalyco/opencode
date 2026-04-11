import { WIDELY_SUPPORTED_EFFORTS } from "../shared"
import type { Transform } from "../types"

export const options: Transform["options"] = (input) => {
  const result: Record<string, any> = {}
  const modelId = input.model.api.id.toLowerCase()

  if (["zai", "zhipuai"].includes(input.model.providerID)) {
    result.thinking = {
      type: "enabled",
      clear_thinking: false,
    }
  }

  if (
    input.model.providerID === "alibaba-cn" &&
    input.model.capabilities.reasoning &&
    !modelId.includes("kimi-k2-thinking")
  ) {
    result.enable_thinking = true
  }

  return result
}

export const variants: Transform["variants"] = (model) => {
  if (!model.capabilities.reasoning) return {}
  const id = model.id.toLowerCase()
  if (
    id.includes("deepseek") ||
    id.includes("minimax") ||
    id.includes("glm") ||
    id.includes("kimi") ||
    id.includes("k2p5") ||
    id.includes("qwen") ||
    id.includes("big-pickle")
  ) {
    return {}
  }
  return Object.fromEntries(WIDELY_SUPPORTED_EFFORTS.map((effort) => [effort, { reasoningEffort: effort }]))
}

export const small: Transform["small"] = () => {
  return {}
}
