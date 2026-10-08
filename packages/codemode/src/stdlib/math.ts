import { Effect } from "effect"
import { constants, type Method, methods } from "../interpreter/native.js"
import { typeError } from "../interpreter/model.js"
import { Obj, coerceToNumber } from "../interpreter/objects.js"
import { preserveConsumerError, withPrimitives } from "../interpreter/callback.js"
import type { Interpreter } from "../interpreter/interpreter.js"

// Bun exposes ES2026 Math.sumPrecise before TypeScript's standard library types.
declare global {
  interface Math {
    sumPrecise(values: Iterable<number>): number
  }
}

export const mathGlobal = <R>(ctx: Interpreter<R>) => {
  const builtins = ctx.builtins
  const math = new Obj(builtins.Object)
  // Convert only the arguments a method consumes; like JS, extras are ignored
  // (so built-ins work as callbacks receiving (element, index, array)).
  const unary = (name: string, op: (a: number) => number): Method => [
    name,
    1,
    (_, args) => withPrimitives(ctx, "number", [args[0]], ([a]) => op(coerceToNumber(a))),
  ]
  const binary = (name: string, op: (a: number, b: number) => number): Method => [
    name,
    2,
    (_, args) =>
      withPrimitives(ctx, "number", [args[0], args[1]], ([a, b]) => op(coerceToNumber(a), coerceToNumber(b))),
  ]
  const variadic = (name: string, op: (...values: Array<number>) => number): Method => [
    name,
    2,
    (_, args) => withPrimitives(ctx, "number", args, (values) => op(...values.map(coerceToNumber))),
  ]
  constants(math, {
    PI: Math.PI,
    E: Math.E,
    LN2: Math.LN2,
    LN10: Math.LN10,
    LOG2E: Math.LOG2E,
    LOG10E: Math.LOG10E,
    SQRT2: Math.SQRT2,
    SQRT1_2: Math.SQRT1_2,
  })
  methods(builtins, math, [
    ["random", 0, () => Math.random()],
    variadic("max", Math.max),
    variadic("min", Math.min),
    variadic("hypot", Math.hypot),
    unary("abs", Math.abs),
    unary("acos", Math.acos),
    unary("acosh", Math.acosh),
    unary("asin", Math.asin),
    unary("asinh", Math.asinh),
    unary("atan", Math.atan),
    binary("atan2", Math.atan2),
    unary("atanh", Math.atanh),
    unary("floor", Math.floor),
    unary("ceil", Math.ceil),
    unary("round", Math.round),
    unary("trunc", Math.trunc),
    unary("sign", Math.sign),
    unary("sqrt", Math.sqrt),
    unary("cbrt", Math.cbrt),
    binary("pow", Math.pow),
    unary("cos", Math.cos),
    unary("cosh", Math.cosh),
    unary("sin", Math.sin),
    unary("sinh", Math.sinh),
    unary("tan", Math.tan),
    unary("tanh", Math.tanh),
    unary("log", Math.log),
    unary("log2", Math.log2),
    unary("log10", Math.log10),
    unary("log1p", Math.log1p),
    unary("exp", Math.exp),
    unary("expm1", Math.expm1),
    unary("f16round", Math.f16round),
    unary("fround", Math.fround),
    unary("clz32", Math.clz32),
    binary("imul", Math.imul),
    [
      "sumPrecise",
      1,
      (_, args) =>
        Effect.gen(function* () {
          const cursor = yield* ctx.iterate(args[0])
          if (cursor === undefined) {
            throw typeError("Math.sumPrecise expects a synchronous iterable.")
          }
          const numbers: Array<number> = []
          while (true) {
            const step = yield* cursor.next
            if (step.done) return Math.sumPrecise(numbers)
            yield* preserveConsumerError(
              cursor.close,
              Effect.sync(() => {
                if (typeof step.value !== "number") {
                  throw typeError("Math.sumPrecise expects an iterable of numbers.")
                }
                numbers.push(step.value)
              }),
            )
          }
        }),
    ],
  ])
  return math
}
