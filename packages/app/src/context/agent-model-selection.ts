export type AgentModelKey = {
  providerID: string
  modelID: string
  variant?: string
}

export type AgentModelState = {
  model?: AgentModelKey
  models?: Record<string, AgentModelKey | null>
}

export function modelForAgent(state: AgentModelState | undefined, agent: string | undefined) {
  if (agent && state?.models) return state.models[agent] ?? undefined
  return state?.model
}

export function setModelForAgent(
  state: AgentModelState | undefined,
  agent: string | undefined,
  model: AgentModelKey | undefined,
) {
  if (!agent) return { ...(state ?? {}), model }
  return {
    ...(state ?? {}),
    models: {
      ...(state?.models ?? {}),
      [agent]: model ?? null,
    },
  }
}
