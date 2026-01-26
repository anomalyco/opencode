const normalize = (directory: string) => directory.replace(/[\\/]+$/, "")

type State =
  | {
      status: "pending"
    }
  | {
      status: "ready"
    }
  | {
      status: "failed"
      message: string
    }

const state = new Map<string, State>()
const waiters = new Map<string, Array<(state: State) => void>>()

export const Worktree = {
  get(directory: string) {
    return state.get(normalize(directory))
  },
  pending(directory: string) {
    const key = normalize(directory)
    const current = state.get(key)
    if (current && current.status !== "pending") return
    state.set(key, { status: "pending" })
  },
  ready(directory: string) {
    const key = normalize(directory)
    state.set(key, { status: "ready" })
    const list = waiters.get(key)
    if (!list) return
    waiters.delete(key)
    for (const fn of list) fn({ status: "ready" })
  },
  failed(directory: string, message: string) {
    const key = normalize(directory)
    state.set(key, { status: "failed", message })
    const list = waiters.get(key)
    if (!list) return
    waiters.delete(key)
    for (const fn of list) fn({ status: "failed", message })
  },
  wait(directory: string) {
    const key = normalize(directory)
    const current = state.get(key)
    if (current && current.status !== "pending") return Promise.resolve(current)

    return new Promise<State>((resolve) => {
      const list = waiters.get(key)
      if (!list) {
        waiters.set(key, [resolve])
        return
      }
      list.push(resolve)
    })
  },
}
