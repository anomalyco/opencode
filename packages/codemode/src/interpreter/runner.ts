import { Effect, Exit } from "effect"
import { Values } from "../values.js"
import { coerceToString } from "../stdlib/value.js"
import { HostFunction } from "./host.js"
import { type AstNode, InterpreterRuntimeError, IntrinsicReference } from "./model.js"
import { get, has, ProgramFunction, ProgramObject } from "./objects.js"
import { typeofValue } from "./references.js"

export type IteratorCursor<R> = {
  readonly next: Effect.Effect<{ readonly done: boolean; readonly value: unknown }, unknown, R>
  readonly close: Effect.Effect<void, unknown, R>
}

/** Everything a host function needs to call back into the program. */
export type Runner<R> = {
  readonly invokeFunction: (fn: ProgramFunction, args: Array<unknown>) => Effect.Effect<unknown, unknown, R>
  readonly invokeCallable: (
    callable: unknown,
    args: Array<unknown>,
    node: AstNode,
  ) => Effect.Effect<unknown, unknown, R>
  readonly settlePromise: (promise: Values.Promise) => Effect.Effect<unknown, unknown, never>
  readonly syncIterator: (value: unknown, node: AstNode) => Effect.Effect<IteratorCursor<R> | undefined, unknown, R>
}

export const preserveConsumerError = <A, R>(
  cursor: IteratorCursor<R>,
  effect: Effect.Effect<A, unknown, R>,
): Effect.Effect<A, unknown, R> =>
  Effect.flatMap(Effect.exit(effect), (exit) =>
    Exit.isSuccess(exit)
      ? Effect.succeed(exit.value)
      : Effect.andThen(Effect.exit(cursor.close), Effect.failCause(exit.cause)),
  )

export const toPrimitive = <R>(
  runner: Runner<R>,
  value: unknown,
  hint: "number" | "string",
  node: AstNode,
): Effect.Effect<unknown, unknown, R> => {
  if (value === null || typeof value !== "object") return Effect.succeed(value)
  if (Values.isValue(value)) {
    return Effect.succeed(value instanceof Values.Date && hint === "number" ? value.time : coerceToString(value))
  }
  if (!(value instanceof ProgramObject)) return Effect.succeed(value)
  const order = hint === "number" ? ["valueOf", "toString"] : ["toString", "valueOf"]
  return Effect.gen(function* () {
    for (const method of order) {
      if (method === "toString" && !has(value, "toString")) return coerceToString(value)
      const callable = get(value, method)
      if (typeofValue(callable) !== "function") continue
      const result = yield* runner.invokeCallable(callable, [], node)
      if (result === null || (typeof result !== "object" && typeof result !== "function")) return result
    }
    throw new InterpreterRuntimeError("Cannot convert object to primitive value.", node).as("TypeError")
  })
}

// The single acceptance list for callbacks: collections, sort, string replacers,
// Array.from mappers, and promise reactions all admit exactly these callables.
// Admission means dispatchable, not necessarily invocable: new-requiring
// constructors pass the gate and throw a TypeError on call, like JS.
export type SupportedCallback = ProgramFunction | HostFunction<unknown> | IntrinsicReference

export const isSupportedCallback = (value: unknown): value is SupportedCallback =>
  value instanceof ProgramFunction ||
  (value instanceof HostFunction && value.callback) ||
  value instanceof IntrinsicReference

export const applyCollectionCallback = <R>(
  runner: Runner<R>,
  callback: unknown,
  name: string,
  node: AstNode,
): ((args: Array<unknown>) => Effect.Effect<unknown, unknown, R>) => {
  if (!isSupportedCallback(callback)) {
    if (typeofValue(callback) === "function") {
      throw new InterpreterRuntimeError(
        `${name} cannot use this callable as a callback; wrap it in an arrow function, e.g. (value) => tools.ns.tool(value).`,
        node,
      )
    }
    throw new InterpreterRuntimeError(`${name} expects a function callback.`, node).as("TypeError")
  }
  return (callbackArgs) => runner.invokeCallable(callback, callbackArgs, node)
}
