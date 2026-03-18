import type { E2EWindow } from "./terminal"

export type PromptProbeState = {
  popover: "at" | "slash" | null
  slash: {
    active: string | null
    ids: string[]
  }
  selected: string | null
  selects: number
}

export const promptEnabled = () => {
  if (typeof window === "undefined") return false
  return (window as E2EWindow).__opencode_e2e?.prompt?.enabled === true
}

const root = () => {
  if (!promptEnabled()) return
  return (window as E2EWindow).__opencode_e2e?.prompt
}

export const promptProbe = {
  set(input: Omit<PromptProbeState, "selected" | "selects">) {
    const state = root()
    if (!state) return
    state.current = {
      popover: input.popover,
      slash: {
        active: input.slash.active,
        ids: [...input.slash.ids],
      },
      selected: state.current?.selected ?? null,
      selects: state.current?.selects ?? 0,
    }
  },
  select(id: string) {
    const state = root()
    if (!state) return
    const prev = state.current
    state.current = {
      popover: prev?.popover ?? null,
      slash: {
        active: prev?.slash.active ?? null,
        ids: [...(prev?.slash.ids ?? [])],
      },
      selected: id,
      selects: (prev?.selects ?? 0) + 1,
    }
  },
  clear() {
    const state = root()
    if (!state) return
    state.current = undefined
  },
}
