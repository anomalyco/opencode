// An iterator whose `next` is not a function fails when it is stepped, naming the call that made its record.
const attempt = (f) => {
  try {
    return f()
  } catch (error) {
    return String(error)
  }
}
const helpers = Iterator.prototype
const wrapped = Iterator.from({ next: 5 })
const mapped = wrapped.map((x) => x)
return {
  from: attempt(() => Iterator.from({ next: 5 }).toArray()),
  fromIterable: attempt(() => Iterator.from({ [Symbol.iterator]: () => ({}) }).next()),
  kept: [attempt(() => wrapped.next()), attempt(() => [...wrapped]), attempt(() => mapped.next())],
  helper: attempt(() => helpers.map.call({ next: 5 }, (x) => x).next()),
  eager: [attempt(() => helpers.toArray.call({ next: 5 })), attempt(() => helpers.some.call({ next: null }, () => true))],
  inner: attempt(() => [1].values().flatMap(() => ({ next: 5 })).next()),
  aliased: (() => {
    const make = Iterator.from
    return attempt(() => make({ next: 5 }).next())
  })(),
  nextResult: attempt(() => Iterator.from({ next: () => 5 }).next()),
}
