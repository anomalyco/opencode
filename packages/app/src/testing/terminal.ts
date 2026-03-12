export const terminalAttr = "data-pty-id"

export type TerminalProbeState = {
  connected: boolean
  rendered: string
  settled: number
}

export type E2EWindow = Window & {
  __opencode_e2e?: {
    terminal?: {
      enabled?: boolean
      terminals?: Record<string, TerminalProbeState>
    }
  }
}

const seed = (): TerminalProbeState => ({
  connected: false,
  rendered: "",
  settled: 0,
})

const root = () => {
  if (typeof window === "undefined") return
  const state = (window as E2EWindow).__opencode_e2e?.terminal
  if (!state?.enabled) return
  state.terminals ??= {}
  return state.terminals
}

export const terminalProbe = (id: string) => {
  const set = (next: Partial<TerminalProbeState>) => {
    const terms = root()
    if (!terms) return
    terms[id] = { ...(terms[id] ?? seed()), ...next }
  }

  return {
    init() {
      set(seed())
    },
    connect() {
      set({ connected: true })
    },
    render(data: string) {
      const terms = root()
      if (!terms) return
      const prev = terms[id] ?? seed()
      terms[id] = { ...prev, rendered: prev.rendered + data }
    },
    settle() {
      const terms = root()
      if (!terms) return
      const prev = terms[id] ?? seed()
      terms[id] = { ...prev, settled: prev.settled + 1 }
    },
    drop() {
      const terms = root()
      if (!terms) return
      delete terms[id]
    },
  }
}
