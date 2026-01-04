export type AgentDefinition = {
  description?: string
  prompt?: string
  model?: string
  mode?: "subagent" | "primary" | "all"
  temperature?: number
  top_p?: number
  color?: string
  steps?: number
  permission?: Record<string, "ask" | "allow" | "deny" | Record<string, "ask" | "allow" | "deny">>
  options?: Record<string, any>
}

/**
 * Helper for defining an agent with type safety.
 * @example
 * agent({
 *   description: "Expert code reviewer",
 *   model: "anthropic/claude-sonnet-4-5",
 *   mode: "subagent",
 *   prompt: "You are a code review expert..."
 * })
 */
export function agent(input: AgentDefinition): AgentDefinition {
  return input
}
