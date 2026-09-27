import { Effect } from "effect"
import { fn, type Method, methods, receiver } from "./native.js"
import { AsyncIteratorSymbol, type GeneratorRequestKind, IteratorSymbol } from "./model.js"
import { define, hidden, GeneratorObj, type Value } from "./objects.js"
import type { Interpreter } from "./interpreter.js"

/** `next`/`return`/`throw` on the generator prototypes; async generators answer with promises. */
export const generatorGlobals = <R>(ctx: Interpreter<R>): void => {
  const builtins = ctx.builtins
  const install = (asynchronous: boolean) => {
    const proto = asynchronous ? builtins.AsyncGenerator : builtins.Generator
    const label = asynchronous ? "AsyncGenerator" : "Generator"
    const request = (kind: GeneratorRequestKind): Method => [
      kind,
      1,
      (thisValue: Value, args: Array<Value>) => {
        const generator = receiver(GeneratorObj, thisValue, `${label}.prototype.${kind}`)
        const requested = generator.request(kind, args[0]) as Effect.Effect<Value, unknown, R>
        return generator.asynchronous ? ctx.pending.create(requested) : requested
      },
    ]
    methods(builtins, proto, [request("next"), request("return"), request("throw")])
    define(
      asynchronous ? builtins.AsyncIterator : builtins.Iterator,
      asynchronous ? AsyncIteratorSymbol : IteratorSymbol,
      fn(builtins, asynchronous ? "[Symbol.asyncIterator]" : "[Symbol.iterator]", 0, (thisValue) => thisValue),
      hidden,
    )
  }
  install(false)
  install(true)
}
