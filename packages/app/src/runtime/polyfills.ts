// Safari before 17.4 lacks Map.groupBy, Promise.withResolvers and AbortSignal.any, and Promise.try arrived in Safari 18.2.
// Electron's Chromium has all four, so these only matter for the web app.
if (!Map.groupBy) {
  Map.groupBy = function groupBy<K, T>(items: Iterable<T>, callback: (item: T, index: number) => K) {
    const groups = new Map<K, T[]>()
    let index = 0

    for (const item of items) {
      const key = callback(item, index++)
      const group = groups.get(key)

      if (group) group.push(item)
      else groups.set(key, [item])
    }

    return groups
  }
}

if (!Promise.withResolvers) {
  Promise.withResolvers = function withResolvers<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void
    let reject!: (reason?: Error) => void

    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })

    return { promise, resolve, reject }
  }
}

if (!Promise.try) {
  // SAFETY: the callback's return type is carried through unchanged, which is all Promise.try promises.
  Promise.try = function tryCall<T, U extends unknown[]>(callback: (...args: U) => T | PromiseLike<T>, ...args: U) {
    return new Promise<T>((resolve) => resolve(callback(...args)))
  } as typeof Promise.try
}

if (typeof (AbortSignal as unknown as { any?: unknown }).any !== "function") {
  ;(AbortSignal as unknown as { any: (signals: Iterable<AbortSignal>) => AbortSignal }).any = function any(
    signals: Iterable<AbortSignal>,
  ) {
    const controller = new AbortController()
    const signalList = [...signals]
    for (const signal of signalList) {
      if (signal.aborted) {
        controller.abort(signal.reason)
        return controller.signal
      }
    }

    const cleanups: (() => void)[] = []
    const onAbort = (event: Event) => {
      const target = event.target as AbortSignal
      controller.abort(target?.reason)
      for (const cleanup of cleanups) cleanup()
      cleanups.length = 0
    }

    for (const signal of signalList) {
      signal.addEventListener("abort", onAbort, { once: true })
      cleanups.push(() => signal.removeEventListener("abort", onAbort))
    }

    return controller.signal
  }
}
