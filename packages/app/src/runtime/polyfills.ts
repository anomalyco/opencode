// Safari before 17.4 lacks Map.groupBy and Promise.withResolvers, and Promise.try arrived in Safari 18.2. Electron's
// Chromium has all three, so these only matter for the web app.
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

// URL.parse landed in Safari 18; the connect screen, the pairing page and the office links all call it.
if (!URL.parse) {
  // SAFETY: absent in these browsers, so the fallback is the whole implementation, and it has the same shape.
  URL.parse = function parse(value: string, base?: string | URL) {
    try {
      return new URL(value, base)
    } catch {
      return null
    }
  } as typeof URL.parse
}

export {}
