type ModelKey = {
  providerID: string
  modelID: string
}

type ModelItem = ModelKey & {
  name: string
}

type AgentItem = {
  name: string
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
  variants?: string[]
  models?: ModelItem[]
  agents?: AgentItem[]
}

export type ModelWindow = Window & {
  __opencode_e2e?: {
    model?: {
      enabled?: boolean
      current?: ModelProbeState
      controls?: {
        setAgent?: (name: string | undefined) => void
        setModel?: (value: ModelKey | undefined) => void
        setVariant?: (value: string | undefined) => void
      }
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

let active: symbol | undefined

export const modelEnabled = () => {
  if (typeof window === "undefined") return false
  return (window as ModelWindow).__opencode_e2e?.model?.enabled === true
}

const root = () => {
  if (!modelEnabled()) return
  return (window as ModelWindow).__opencode_e2e?.model
}

export const modelProbe = {
  bind(id: symbol, input: NonNullable<NonNullable<ModelWindow["__opencode_e2e"]>["model"]>["controls"]) {
    const state = root()
    if (!state) return
    active = id
    state.controls = input
  },
  set(id: symbol, input: ModelProbeState) {
    const state = root()
    if (!state || active !== id) return
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
      variants: input.variants?.slice(),
      models: input.models?.map((item) => ({ ...item })),
      agents: input.agents?.map((item) => ({ ...item })),
    }
  },
  clear(id: symbol) {
    const state = root()
    if (!state || active !== id) return
    active = undefined
    state.current = undefined
    state.controls = undefined
  },
}
