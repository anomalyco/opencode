import type { Todo } from "@opencode-ai/sdk/v2"

export const composerEvent = "opencode:e2e:composer"

export type ComposerDriverState = {
  live?: boolean
  todos?: Array<Pick<Todo, "content" | "status" | "priority">>
}

export type ComposerProbeState = {
  mounted: boolean
  collapsed: boolean
  hidden: boolean
  count: number
  states: Todo["status"][]
}

type ComposerState = {
  driver?: ComposerDriverState
  probe?: ComposerProbeState
}

export type ComposerWindow = Window & {
  __opencode_e2e?: {
    composer?: {
      enabled?: boolean
      sessions?: Record<string, ComposerState>
    }
  }
}

const clone = (driver: ComposerDriverState) => ({
  live: driver.live,
  todos: driver.todos?.map((todo) => ({ ...todo })),
})

export const composerEnabled = () => {
  if (typeof window === "undefined") return false
  return (window as ComposerWindow).__opencode_e2e?.composer?.enabled === true
}

const root = () => {
  if (!composerEnabled()) return
  const state = (window as ComposerWindow).__opencode_e2e?.composer
  if (!state) return
  state.sessions ??= {}
  return state.sessions
}

export const composerDriver = (sessionID?: string) => {
  if (!sessionID) return
  const state = root()?.[sessionID]?.driver
  if (!state) return
  return clone(state)
}

export const composerProbe = (sessionID?: string) => {
  const set = (next: ComposerProbeState) => {
    if (!sessionID) return
    const sessions = root()
    if (!sessions) return
    const prev = sessions[sessionID] ?? {}
    sessions[sessionID] = {
      ...prev,
      probe: {
        ...next,
        states: [...next.states],
      },
    }
  }

  return {
    set,
    drop() {
      set({
        mounted: false,
        collapsed: false,
        hidden: true,
        count: 0,
        states: [],
      })
    },
  }
}
