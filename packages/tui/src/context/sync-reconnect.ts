type ReconnectCallbacks = {
  readonly bootstrap: () => Promise<void>
  readonly targets: () => readonly string[]
  readonly exists: (sessionID: string) => boolean
  readonly forceSync: (sessionID: string) => Promise<void>
  readonly onError: (failure: ReconnectFailure) => void
}

export type ReconnectFailure =
  | { readonly boundary: "bootstrap"; readonly error: unknown }
  | { readonly boundary: "session"; readonly sessionID: string; readonly error: unknown }

export function createReconnectCoordinator(_callbacks: ReconnectCallbacks) {
  let epoch = 0
  let disposed = false
  let dirty = false
  let active: Promise<void> | undefined
  const failed = new Set<string>()

  async function pass() {
    const targets = [...new Set([..._callbacks.targets(), ...failed])]
    let bootstrapSucceeded = true
    await Promise.resolve()
      .then(_callbacks.bootstrap)
      .catch((error: unknown) => {
        if (disposed) return
        bootstrapSucceeded = false
        _callbacks.onError({ boundary: "bootstrap", error })
      })
    if (disposed) return

    const eligible = bootstrapSucceeded ? targets.filter(_callbacks.exists) : targets
    if (bootstrapSucceeded) {
      for (const sessionID of targets) {
        if (!_callbacks.exists(sessionID)) failed.delete(sessionID)
      }
    }
    const results = await Promise.allSettled(eligible.map((sessionID) => _callbacks.forceSync(sessionID)))
    if (disposed) return
    for (const [index, result] of results.entries()) {
      const sessionID = eligible[index]
      if (result.status === "fulfilled") {
        failed.delete(sessionID)
        continue
      }
      failed.add(sessionID)
      _callbacks.onError({ boundary: "session", sessionID, error: result.reason })
    }
  }

  function connected() {
    if (disposed) return Promise.resolve()
    epoch += 1
    if (epoch === 1) return Promise.resolve()
    if (active) {
      dirty = true
      return active
    }

    dirty = true
    const owner = Promise.withResolvers<void>()
    active = owner.promise
    void (async () => {
      try {
        while (dirty) {
          if (disposed) return
          dirty = false
          await pass()
        }
      } finally {
        active = undefined
      }
    })().then(owner.resolve, owner.reject)
    return owner.promise
  }

  return {
    connected,
    dispose() {
      disposed = true
      dirty = false
    },
  }
}
