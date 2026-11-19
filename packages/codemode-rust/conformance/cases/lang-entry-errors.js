// new Map and Object.fromEntries reject an entry that is not an object as they reach it, closing the iterator.
const attempt = (f) => {
  try {
    return f()
  } catch (error) {
    return String(error)
  }
}
const closing = (items) => {
  const log = []
  const iterable = {
    [Symbol.iterator]() {
      let i = 0
      return {
        next: () => (i < items.length ? { done: false, value: items[i++] } : { done: true }),
        return() {
          log.push("closed")
          return {}
        },
      }
    },
  }
  return [iterable, log]
}
const [entries, mapLog] = closing([[1, 2], null])
const [pairs, objectLog] = closing([["a", 1], "ab"])
return {
  map: [attempt(() => new Map([[1, 2], , ])), attempt(() => new Map([1])), attempt(() => new Map(entries)), mapLog],
  weakMap: attempt(() => new WeakMap([1])),
  fromEntries: [
    attempt(() => Object.fromEntries([["a", 1], , ])),
    attempt(() => Object.fromEntries(["ab"])),
    attempt(() => Object.fromEntries([() => 1])),
    attempt(() => Object.fromEntries([[1, () => 2]])),
    attempt(() => Object.fromEntries(pairs)),
    objectLog,
  ],
  fine: Object.fromEntries(new Map([["b", 2]])),
}
