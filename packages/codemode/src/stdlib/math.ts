import { Effect } from "effect"
import { HostFunction, HostNamespace, sync } from "../interpreter/host.js"
import { preserveConsumerError, type SyncIteratorRunner } from "../interpreter/runner.js"
import { type AstNode, InterpreterRuntimeError } from "../interpreter/model.js"

// Bun exposes ES2026 Math.sumPrecise before TypeScript's standard library types.
declare global {
  interface Math {
    sumPrecise(values: Iterable<number>): number
  }
}

// Validate only the arguments a method consumes; like JS, extras are ignored
// (so built-ins work as callbacks receiving (element, index, array)).
const number = (name: string, args: Array<unknown>, index: number, node: AstNode): number => {
  if (index >= args.length) return Number.NaN
  const arg = args[index]
  if (typeof arg !== "number") throw new InterpreterRuntimeError(`Math.${name} expects number arguments.`, node)
  return arg
}

const unary = (name: string, op: (a: number) => number) =>
  sync(`Math.${name}`, (args, node) => op(number(name, args, 0, node)))

const binary = (name: string, op: (a: number, b: number) => number) =>
  sync(`Math.${name}`, (args, node) => op(number(name, args, 0, node), number(name, args, 1, node)))

const variadic = (name: string, op: (...values: Array<number>) => number) =>
  sync(`Math.${name}`, (args, node) =>
    op(
      ...args.map((arg) => {
        if (typeof arg !== "number") throw new InterpreterRuntimeError(`Math.${name} expects number arguments.`, node)
        return arg
      }),
    ),
  )

const sumPrecise = <R>(runner: SyncIteratorRunner<R>) =>
  new HostFunction<R>({
    name: "Math.sumPrecise",
    call: (args, node) =>
      Effect.gen(function* () {
        const cursor = yield* runner.syncIterator(args[0], node)
        if (cursor === undefined) {
          throw new InterpreterRuntimeError("Math.sumPrecise expects a synchronous iterable.", node).as("TypeError")
        }
        const numbers: Array<number> = []
        while (true) {
          const step = yield* cursor.next
          if (step.done) return Math.sumPrecise(numbers)
          yield* preserveConsumerError(
            cursor,
            Effect.sync(() => {
              if (typeof step.value !== "number") {
                throw new InterpreterRuntimeError("Math.sumPrecise expects an iterable of numbers.", node).as(
                  "TypeError",
                )
              }
              numbers.push(step.value)
            }),
          )
        }
      }),
  })

export const mathGlobal = <R>(runner: SyncIteratorRunner<R>) =>
  new HostNamespace("Math", {
    PI: Math.PI,
    E: Math.E,
    LN2: Math.LN2,
    LN10: Math.LN10,
    LOG2E: Math.LOG2E,
    LOG10E: Math.LOG10E,
    SQRT2: Math.SQRT2,
    SQRT1_2: Math.SQRT1_2,
    random: sync("Math.random", () => Math.random()),
    max: variadic("max", Math.max),
    min: variadic("min", Math.min),
    hypot: variadic("hypot", Math.hypot),
    abs: unary("abs", Math.abs),
    acos: unary("acos", Math.acos),
    acosh: unary("acosh", Math.acosh),
    asin: unary("asin", Math.asin),
    asinh: unary("asinh", Math.asinh),
    atan: unary("atan", Math.atan),
    atan2: binary("atan2", Math.atan2),
    atanh: unary("atanh", Math.atanh),
    floor: unary("floor", Math.floor),
    ceil: unary("ceil", Math.ceil),
    round: unary("round", Math.round),
    trunc: unary("trunc", Math.trunc),
    sign: unary("sign", Math.sign),
    sqrt: unary("sqrt", Math.sqrt),
    cbrt: unary("cbrt", Math.cbrt),
    pow: binary("pow", Math.pow),
    cos: unary("cos", Math.cos),
    cosh: unary("cosh", Math.cosh),
    sin: unary("sin", Math.sin),
    sinh: unary("sinh", Math.sinh),
    tan: unary("tan", Math.tan),
    tanh: unary("tanh", Math.tanh),
    log: unary("log", Math.log),
    log2: unary("log2", Math.log2),
    log10: unary("log10", Math.log10),
    log1p: unary("log1p", Math.log1p),
    exp: unary("exp", Math.exp),
    expm1: unary("expm1", Math.expm1),
    f16round: unary("f16round", Math.f16round),
    fround: unary("fround", Math.fround),
    clz32: unary("clz32", Math.clz32),
    imul: binary("imul", Math.imul),
    sumPrecise: sumPrecise(runner),
  })
