import { fn, type Method, methods, receiver } from "./native.js"
import { AsyncIteratorSymbol, type GeneratorRequestKind, IteratorSymbol, typeError } from "./model.js"
import { define, hidden, GeneratorObj } from "./objects.js"
import type { Interpreter } from "./interpreter.js"
import { Push } from "./signals.js"
import { AsyncFromSyncIterator, generatorRequest, generatorStep } from "../generators.js"

/**
 * `next`/`return`/`throw` on the generator prototypes (async generators answer with promises), on iterator helpers,
 * and on the async-from-sync iterator. A generator's suspended body runs on the caller's job stack.
 */
export const generatorGlobals = <R>(ctx: Interpreter<R>): void => {
  const builtins = ctx.builtins
  const sync = (kind: GeneratorRequestKind, owner = "Generator.prototype"): Method => [
    kind,
    1,
    (thisValue, args) => {
      const method = `${owner}.${kind}`
      const generator = receiver(GeneratorObj, thisValue, method)
      if (generator.asynchronous) throw typeError(`${method} called on incompatible receiver an async generator.`)
      return generatorStep(ctx.vm, generator, kind, args[0])
    },
  ]
  const async = (kind: GeneratorRequestKind): Method => [
    kind,
    1,
    (thisValue, args) => generatorRequest(ctx.vm, thisValue, kind, args[0]),
  ]
  const adapter = (kind: GeneratorRequestKind): Method => [
    kind,
    1,
    (thisValue, args) =>
      new Push("AsyncFromSyncIterator", [
        receiver(AsyncFromSyncIterator, thisValue, `AsyncFromSyncIterator.${kind}`),
        kind,
        args,
      ]),
  ]
  methods(builtins, builtins.Generator, [sync("next"), sync("return"), sync("throw")])
  // Iterator helpers are the prelude's generators (see prelude.ts).
  methods(builtins, builtins.IteratorHelper, [sync("next", "%IteratorHelper%"), sync("return", "%IteratorHelper%")])
  methods(builtins, builtins.AsyncGenerator, [async("next"), async("return"), async("throw")])
  methods(builtins, builtins.AsyncFromSyncIterator, [adapter("next"), adapter("return"), adapter("throw")])
  define(
    builtins.Iterator,
    IteratorSymbol,
    fn(builtins, "[Symbol.iterator]", 0, (thisValue) => thisValue),
    hidden,
  )
  define(
    builtins.AsyncIterator,
    AsyncIteratorSymbol,
    fn(builtins, "[Symbol.asyncIterator]", 0, (thisValue) => thisValue),
    hidden,
  )
}
