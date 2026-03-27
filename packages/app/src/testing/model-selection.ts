type ModelKey = {
  providerID: string
  modelID: string
}

type State = {
  agent?: string
  model?: ModelKey | null
  variant?: string | null
}

export type ModelProbeState = {
  dir?: string
  sessionID?: string
  last?: {
    type: "agent" | "model" | "variant"
    agent?: string
    model?: ModelKey | null
    variant?: string | null
  }
  agent?: string
  model?: (ModelKey & { name?: string }) | undefined
  variant?: string | null
  selected?: string | null
  configured?: string
  pick?: State
  base?: State
  current?: string
}

export type ModelWindow = Window & {
  __opencode_e2e?: {
    model?: {
      enabled?: boolean
      current?: ModelProbeState
    }
  }
}

const clone = (state?: State) => {
  if (!state) return undefined
  return {
    ...state,
    model: state.model ? { ...state.model } : state.model,
  }
}

export const modelEnabled = () => {
  if (typeof window === "undefined") return false
  return (window as ModelWindow).__opencode_e2e?.model?.enabled === true
}

const root = () => {
  if (!modelEnabled()) return
  return (window as ModelWindow).__opencode_e2e?.model
}

export const modelProbe = {
  set(input: ModelProbeState) {
    const state = root()
    if (!state) return
    state.current = {
      ...input,
      model: input.model ? { ...input.model } : undefined,
      last: input.last
        ? {
            ...input.last,
            model: input.last.model ? { ...input.last.model } : input.last.model,
          }
        : undefined,
      pick: clone(input.pick),
      base: clone(input.base),
    }
  },
  clear() {
    const state = root()
    if (!state) return
    state.current = undefined
  },
}
