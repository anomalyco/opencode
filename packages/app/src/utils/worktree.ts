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
const waiters = new Map<
  string,
  {
    promise: Promise<State>
    resolve: (state: State) => void
  }
>()

function resolveWaiter(key: string, next: State) {
  const waiter = waiters.get(key)
  if (!waiter) return
  waiters.delete(key)
  waiter.resolve(next)
}

function deferred() {
  const box = { resolve: (_: State) => {} }
  const promise = new Promise<State>((resolve) => {
    box.resolve = resolve
  })
  return { promise, resolve: box.resolve }
}

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
    const next = { status: "ready" } as const
    state.set(key, next)
    resolveWaiter(key, next)
  },
  failed(directory: string, message: string) {
    const key = normalize(directory)
    const next = { status: "failed", message } as const
    state.set(key, next)
    resolveWaiter(key, next)
  },
  forget(directory: string, message = "cancelled") {
    const key = normalize(directory)
    state.delete(key)
    resolveWaiter(key, { status: "failed", message })
  },
  wait(directory: string) {
    const key = normalize(directory)
    const current = state.get(key)
    if (current && current.status !== "pending") return Promise.resolve(current)

    const existing = waiters.get(key)
    if (existing) return existing.promise

    const waiter = deferred()

    waiters.set(key, waiter)
    return waiter.promise
  },
}
