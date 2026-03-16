import type { ModelProbeState } from "./model-selection"

export const terminalAttr = "data-pty-id"

export type TerminalProbeState = {
  connected: boolean
  connects: number
  rendered: string
  settled: number
}

type TerminalProbeControl = {
  disconnect?: VoidFunction
}

export type E2EWindow = Window & {
  __opencode_e2e?: {
    model?: {
      enabled?: boolean
      current?: ModelProbeState
    }
    terminal?: {
      enabled?: boolean
      terminals?: Record<string, TerminalProbeState>
      controls?: Record<string, TerminalProbeControl>
    }
  }
}

const seed = (): TerminalProbeState => ({
  connected: false,
  connects: 0,
  rendered: "",
  settled: 0,
})

const root = () => {
  if (typeof window === "undefined") return
  const state = (window as E2EWindow).__opencode_e2e?.terminal
  if (!state?.enabled) return
  return state
}

const terms = () => {
  const state = root()
  if (!state) return
  state.terminals ??= {}
  return state.terminals
}

const controls = () => {
  const state = root()
  if (!state) return
  state.controls ??= {}
  return state.controls
}

export const terminalProbe = (id: string) => {
  const set = (next: Partial<TerminalProbeState>) => {
    const state = terms()
    if (!state) return
    state[id] = { ...(state[id] ?? seed()), ...next }
  }

  return {
    init() {
      set(seed())
    },
    connect() {
      const state = terms()
      if (!state) return
      const prev = state[id] ?? seed()
      state[id] = {
        ...prev,
        connected: true,
        connects: prev.connects + 1,
      }
    },
    render(data: string) {
      const state = terms()
      if (!state) return
      const prev = state[id] ?? seed()
      state[id] = { ...prev, rendered: prev.rendered + data }
    },
    settle() {
      const state = terms()
      if (!state) return
      const prev = state[id] ?? seed()
      state[id] = { ...prev, settled: prev.settled + 1 }
    },
    control(next: Partial<TerminalProbeControl>) {
      const state = controls()
      if (!state) return
      state[id] = { ...(state[id] ?? {}), ...next }
    },
    drop() {
      const state = terms()
      if (state) delete state[id]
      const control = controls()
      if (control) delete control[id]
    },
  }
}
