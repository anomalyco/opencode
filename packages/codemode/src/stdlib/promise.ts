import { HostFunction, requiresNew } from "../interpreter/host.js"
import { InterpreterRuntimeError } from "../interpreter/model.js"
import { constructPromise, invokePromiseMethod, type PromiseRuntime } from "../interpreter/promises.js"
import type { Runner } from "../interpreter/runner.js"
import { Values } from "../values.js"

const promiseStatics = ["all", "allSettled", "race", "any", "resolve", "reject"] as const

export type PromiseMethodName = (typeof promiseStatics)[number]

export const promiseGlobal = <R>(runner: Runner<R>, promises: PromiseRuntime<R>) => {
  // Combinators are not callbacks: `[p].map(Promise.resolve)` must ask for an arrow function.
  const statics = new Map(
    promiseStatics.map((name) => [
      name,
      new HostFunction<R>({
        name: `Promise.${name}`,
        call: (args, node) => invokePromiseMethod(runner, promises, name, args, node),
        callback: false,
      }),
    ]),
  )
  return new HostFunction<R>({
    name: "Promise",
    call: requiresNew("Promise"),
    construct: (args, node) => constructPromise(runner, promises, args[0], node),
    instanceOf: (value) => value instanceof Values.Promise,
    // Unknown statics fail loudly so a missing await cannot hide behind `undefined`.
    members: (key, node) => {
      const method = typeof key === "string" ? statics.get(key as PromiseMethodName) : undefined
      if (method !== undefined) return method
      throw new InterpreterRuntimeError(
        `Promise.${String(key)} is not available. Available: Promise.all, Promise.allSettled, Promise.race, Promise.any, Promise.resolve, and Promise.reject; consume promises with await.`,
        node,
      )
    },
  })
}
