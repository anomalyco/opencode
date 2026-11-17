// The errors for iterators that break the protocol, in each place a program opens or steps one.
const attempt = async (f) => {
  try {
    return await f()
  } catch (error) {
    return String(error)
  }
}
const sync = (iterator) => ({ [Symbol.iterator]: () => iterator })
const asyncOf = (iterator) => ({ [Symbol.asyncIterator]: () => iterator })
const step = () => ({ done: false, value: 1 })
return {
  method: await attempt(() => [...{ [Symbol.iterator]: 1 }]),
  methodResult: await attempt(() => [...{ [Symbol.iterator]: () => 1 }]),
  next: await attempt(() => [...sync({ next: 5 })]),
  nextResult: await attempt(() => [...sync({ next: () => 5 })]),
  returnMethod: await attempt(() => {
    for (const x of sync({ next: step, return: 7 })) break
  }),
  returnResult: await attempt(() => {
    const [a] = sync({ next: step, return: () => 5 })
  }),
  bodyErrorWins: await attempt(() => {
    for (const x of sync({ next: step, return: 7 })) throw new Error("body")
  }),
  delegateReturn: await attempt(() => {
    const g = (function* () {
      yield* sync({ next: step, return: () => 5 })
    })()
    g.next()
    return g.return(1)
  }),
  delegateThrow: await attempt(() => {
    const g = (function* () {
      yield* sync({ next: step, throw: 3 })
    })()
    g.next()
    return g.throw(new Error("x"))
  }),
  asyncDelegate: await attempt(async () => {
    const g = (async function* () {
      yield* 5
    })()
    return await g.next()
  }),
  asyncMethod: await attempt(async () => {
    for await (const x of { [Symbol.asyncIterator]: 1 });
  }),
  asyncNextResult: await attempt(async () => {
    for await (const x of asyncOf({ next: async () => 5 }));
  }),
  asyncReturn: await attempt(async () => {
    for await (const x of asyncOf({ next: async () => step(), return: 7 })) break
  }),
  asyncReturnResult: await attempt(async () => {
    for await (const x of asyncOf({ next: async () => step(), return: () => 5 })) break
  }),
}
