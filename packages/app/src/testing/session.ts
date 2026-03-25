import type { E2EWindow } from "./terminal"

type Controls = {
  promote?: (dir: string, session: string) => void
}

const root = () => {
  if (typeof window === "undefined") return
  const state = (window as E2EWindow).__opencode_e2e?.session
  if (!state?.enabled) return
  return state
}

export const sessionEnabled = () => !!root()

export const sessionProbe = {
  control(next: Controls) {
    const state = root()
    if (!state) return
    state.controls = { ...(state.controls ?? {}), ...next }
  },
  clear() {
    const state = root()
    if (!state) return
    state.controls = undefined
  },
}
