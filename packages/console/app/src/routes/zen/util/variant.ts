export function parseAnthropicVariant(body: any) {
  const effort = body.effort ?? body.output_config?.effort ?? body.outputConfig?.effort ?? body.thinking?.effort
  if (effort) return effort

  const budget = body.thinking?.budget_tokens ?? body.thinking?.budgetTokens
  if (body.thinking?.type !== "enabled" || typeof budget !== "number") return undefined
  return budget > 16_000 ? "max" : "high"
}

export function parseGoogleVariant(body: any) {
  const thinkingConfig = body.generationConfig?.thinkingConfig ?? body.thinkingConfig
  if (thinkingConfig?.thinkingLevel) return thinkingConfig.thinkingLevel

  const budget = thinkingConfig?.thinkingBudget ?? thinkingConfig?.thinking_budget
  if (typeof budget !== "number" || budget <= 0) return undefined
  return budget > 16_000 ? "max" : "high"
}

export function parseOpenAiVariant(body: any) {
  return body.reasoningEffort ?? body.reasoning_effort ?? body.reasoning?.effort
}
