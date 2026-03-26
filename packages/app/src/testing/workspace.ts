export type WorkspaceProbeItem = {
  directory: string
  slug: string
  busy: boolean
  expanded: boolean
  local: boolean
}

export type WorkspaceProbeState = {
  root?: string
  current?: string
  enabled: boolean
  items: WorkspaceProbeItem[]
}

type WorkspaceProbeControl = {
  reorder?: (input: { from: string; to: string }) => boolean
}

type WorkspaceWindow = Window & {
  __opencode_e2e?: {
    workspace?: {
      enabled?: boolean
      current?: WorkspaceProbeState
      controls?: Record<string, WorkspaceProbeControl>
    }
  }
}

export const workspaceEnabled = () => {
  if (typeof window === "undefined") return false
  return (window as WorkspaceWindow).__opencode_e2e?.workspace?.enabled === true
}

const root = () => {
  if (!workspaceEnabled()) return
  const state = (window as WorkspaceWindow).__opencode_e2e?.workspace
  if (!state) return
  state.controls ??= {}
  return state
}

export const workspaceProbe = {
  set(input: WorkspaceProbeState) {
    const state = root()
    if (!state) return
    state.current = {
      root: input.root,
      current: input.current,
      enabled: input.enabled,
      items: input.items.map((item) => ({ ...item })),
    }
  },
  clear() {
    const state = root()
    if (!state) return
    state.current = undefined
  },
  control(rootDir: string, next?: WorkspaceProbeControl) {
    const state = root()
    if (!state) return
    if (!next) {
      delete state.controls?.[rootDir]
      return
    }
    state.controls ??= {}
    state.controls[rootDir] = { ...next }
  },
}
