import { ScopedKey, type ServerScope } from "@/utils/server-scope"

const normalize = (directory: string) => directory.replace(/[\\/]+$/, "")
const key = (scope: ServerScope, directory: string) => ScopedKey.from(scope, normalize(directory))

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

function deferred() {
  const box = { resolve: (_: State) => {} }
  const promise = new Promise<State>((resolve) => {
    box.resolve = resolve
  })
  return { promise, resolve: box.resolve }
}

export const Worktree = {
  get(scope: ServerScope, directory: string) {
    return state.get(key(scope, directory))
  },
  pending(scope: ServerScope, directory: string) {
    const id = key(scope, directory)
    const current = state.get(id)
    if (current && current.status !== "pending") return
    state.set(id, { status: "pending" })
  },
  ready(scope: ServerScope, directory: string) {
    const id = key(scope, directory)
    const next = { status: "ready" } as const
    state.set(id, next)
    const waiter = waiters.get(id)
    if (!waiter) return
    waiters.delete(id)
    waiter.resolve(next)
  },
  failed(scope: ServerScope, directory: string, message: string) {
    const id = key(scope, directory)
    const next = { status: "failed", message } as const
    state.set(id, next)
    const waiter = waiters.get(id)
    if (!waiter) return
    waiters.delete(id)
    waiter.resolve(next)
  },
  wait(scope: ServerScope, directory: string) {
    const id = key(scope, directory)
    const current = state.get(id)
    if (current && current.status !== "pending") return Promise.resolve(current)

    const existing = waiters.get(id)
    if (existing) return existing.promise

    const waiter = deferred()

    waiters.set(id, waiter)
    return waiter.promise
  },
}
