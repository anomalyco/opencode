// Safari before 17.4 lacks Map.groupBy and Promise.withResolvers, and Promise.try arrived in Safari 18.2. Android's
// system WebView before 110 (and Safari before 16.4) lacks the change-array-by-copy methods the runtime uses
// throughout. Electron's Chromium has all of these, so they only matter for the web app.
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

if (!Array.prototype.toSorted) {
  // SAFETY: the comparator's types flow through the copy unchanged, which is all toSorted promises.
  Array.prototype.toSorted = function toSorted<T>(this: T[], compareFn?: (a: T, b: T) => number): T[] {
    return [...this].sort(compareFn)
  }
}

if (!Array.prototype.toReversed) {
  Array.prototype.toReversed = function toReversed<T>(this: T[]): T[] {
    return [...this].reverse()
  }
}

if (!Array.prototype.toSpliced) {
  // SAFETY: splice deletes to the end of the array only when deleteCount is an absent argument, and toSpliced skips
  // nothing when start itself is absent, so the shim mirrors those argument-count distinctions. A present-but-
  // undefined deleteCount deletes nothing, which the 0 fallback matches.
  Array.prototype.toSpliced = function toSpliced<T>(this: T[], ...args: [start?: number, deleteCount?: number, ...items: T[]]): T[] {
    const [start, deleteCount, ...items] = args
    const copy = [...this]

    if (args.length > 1) copy.splice(start ?? 0, deleteCount ?? 0, ...items)
    else if (args.length === 1) copy.splice(start ?? 0)

    return copy
  }
}
