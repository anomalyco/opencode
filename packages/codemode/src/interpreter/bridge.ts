import type { Expression } from "acorn"
import { ToolReference } from "../tool-runtime.js"
import { locate } from "./errors.js"
import type { Interpreter } from "./interpreter.js"
import type { Builtins } from "./intrinsics.js"
import { type AstNode, AsyncIteratorSymbol, GeneratorReturn, IteratorSymbol, Throw, typeError } from "./model.js"
import { native } from "./native.js"
import {
  Builtin,
  type Cursor,
  define,
  Fn,
  get,
  hidden,
  IteratorObj,
  iteratorResult,
  type NativeCall,
  type NativeResult,
  Obj,
  type PromiseObj,
  type Step,
  type Value,
} from "./objects.js"
import {
  builtinCursor,
  type CustomIterator,
  notAFunction,
  requireIteratorMethod,
  requireIteratorObject,
} from "./operations.js"
import { capability } from "./promises.js"
import { describeValue } from "./references.js"
import {
  Await,
  type Eval,
  type GeneratorRequest,
  Interruption,
  Invoke,
  isEval,
  normal,
  Slice,
  Yield,
} from "./signals.js"

/**
 * Interpreter work for the built-ins that still run as host generators in native frames: calls into the program,
 * iterating, `yield*`, and the async-from-sync iterator adapter. A program function it calls is an `Invoke` the
 * machine runs on its own stack.
 *
 * Phase 2c moves `yield*` and the async-from-sync adapter onto machine frames, and phase 3 replaces the built-ins that
 * call program code with the prelude, after which this goes away.
 */
export class Bridge<R> {
  constructor(private readonly ctx: Interpreter<R>) {}

  /** Await: suspends the innermost async body until `value` settles. */
  *awaitValue(value: Value, node?: AstNode): Eval<Value> {
    return (yield new Await(value, node)) as Value
  }

  *call(callable: Value, thisValue: Value, args: Array<Value>, node?: AstNode, callee?: Expression): Eval<Value> {
    const result = this.dispatch(callable, thisValue, args, node, callee)
    if (isEval(result)) return yield* result
    return result instanceof Invoke ? ((yield result) as Value) : result
  }

  // The single dispatch for every call a built-in makes. A program function is an `Invoke` for the machine to run on
  // its stack; a built-in that returns a value needs no generator.
  private dispatch(
    callable: Value,
    thisValue: Value,
    args: Array<Value>,
    node?: AstNode,
    callee?: Expression,
  ): Value | Eval<Value> | Invoke {
    if (callable instanceof Fn) return new Invoke(callable, thisValue, args, node)
    if (callable instanceof Builtin) {
      const ctx = this.ctx
      // A loop made only of built-in calls has no program call or loop back-edge to count, so count the call.
      if (ctx.machine.tick())
        return afterSlice(() => this.native(() => callable.invoke(ctx, thisValue, args, node), node))
      return this.native(() => callable.invoke(ctx, thisValue, args, node), node)
    }
    if (callable instanceof ToolReference) {
      if (callable.path.length === 0) {
        throw typeError("The tools root is not callable.", callee ?? node)
      }
      return this.ctx.toolCall(callable.path, args, node)
    }
    throw notAFunction(callee, node)
  }

  // Built-ins throw without a location, synchronously or inside their work; the call site supplies it.
  private native(body: () => NativeResult, node?: AstNode): Value | Eval<Value> {
    let result: NativeResult
    try {
      result = body()
    } catch (error) {
      throw locate(error, node)
    }
    return isEval(result) ? located(result, node) : result
  }

  // CreateAsyncFromSyncIterator: an async iterator over a synchronous one. Each `next()` promise settles a job after
  // the value does, and a rejected value closes the synchronous iterator first; `return()` calls the synchronous
  // iterator's own `return`, or settles at once when it has none.
  asyncFromSync(
    builtin: Cursor | undefined,
    custom: CustomIterator | undefined,
    node: AstNode | undefined,
  ): CustomIterator {
    const ctx = this.ctx
    const machine = ctx.machine
    const builtins = ctx.builtins
    const result = (value: Value, done: boolean) => iteratorResult(builtins.Object, value, done)
    const self = this
    // IteratorNext passes the value `next` received, when it received one.
    const syncNext = function* (args: Array<Value>): Eval<Step> {
      if (!custom) return yield* builtin!.next()
      const object = requireIteratorObject(
        yield* self.call(custom.next, custom.iterator, args, node),
        "Iterator next() result",
        node,
      )
      return { done: Boolean(get(object, "done")), value: get(object, "value") }
    }
    // The synchronous iterator's `return`, looked up when it is needed; built-in collection iterators have none.
    const syncReturn = (): Value => (custom ? get(custom.iterator, "return") : undefined)
    const settle = (step: Step, closeOnRejection: boolean, made: ReturnType<typeof capability>) => {
      const rejected = (reason: unknown) => {
        if (step.done || !closeOnRejection || reason instanceof Interruption) return made.reject(reason)
        const body = function* (): Eval<void> {
          try {
            if (custom) yield* self.closeIterator(custom, node)
            else yield* builtin!.close()
          } catch {
            // The rejection wins over a failing close.
          }
          made.reject(reason)
        }
        return body()
      }
      let wrapper: PromiseObj
      try {
        wrapper = machine.promiseResolve(step.value)
      } catch (error) {
        const body = rejected(error)
        if (body !== undefined)
          machine.enqueue({ kind: "resume", frames: [machine.job(body)], input: normal(undefined) })
        return
      }
      machine.then(wrapper, {
        kind: "callback",
        run: (settled) =>
          settled.ok ? made.resolve(result(settled.value as Value, step.done)) : rejected(settled.error),
      })
    }
    const next = asyncFromSyncMethod(builtins, "next", function* (_, args) {
      const made = capability(ctx, node)
      try {
        settle(yield* syncNext(args), true, made)
      } catch (error) {
        made.reject(error)
      }
      return made.promise
    })
    const close = asyncFromSyncMethod(builtins, "return", function* (_, args) {
      const made = capability(ctx, node)
      try {
        const method = syncReturn()
        if (method === undefined || method === null) {
          if (builtin !== undefined) yield* builtin.close()
          made.resolve(result(args[0], true))
          return made.promise
        }
        const returned = requireIteratorObject(
          yield* self.call(requireIteratorMethod(method, "Iterator return", node), custom!.iterator, args, node),
          "Iterator return() result",
          node,
        )
        settle({ done: Boolean(get(returned, "done")), value: get(returned, "value") }, false, made)
      } catch (error) {
        made.reject(error)
      }
      return made.promise
    })
    const raise = asyncFromSyncMethod(builtins, "throw", function* (_, args) {
      const made = capability(ctx, node)
      try {
        const method = custom ? get(custom.iterator, "throw") : undefined
        if (method === undefined || method === null) {
          if (custom) yield* self.closeIterator(custom, node)
          else yield* builtin!.close()
          made.reject(typeError("The delegated iterator does not provide a throw() method.", node))
          return made.promise
        }
        const thrown = requireIteratorObject(
          yield* self.call(requireIteratorMethod(method, "Iterator throw", node), custom!.iterator, args, node),
          "Iterator throw() result",
          node,
        )
        settle({ done: Boolean(get(thrown, "done")), value: get(thrown, "value") }, true, made)
      } catch (error) {
        made.reject(error)
      }
      return made.promise
    })
    const adapter = new Obj(builtins.Object)
    define(adapter, "next", next, hidden)
    define(adapter, "return", close, hidden)
    define(adapter, "throw", raise, hidden)
    return { iterator: adapter, next, asynchronous: true }
  }

  *iterate(value: Value, node?: AstNode): Eval<Cursor | undefined> {
    const cursor = builtinCursor(this.ctx.builtins, value)
    if (cursor !== undefined) return cursor
    const iterator = yield* this.customIterator(value, node, false)
    return iterator === undefined ? undefined : this.customCursor(iterator, node)
  }

  /** GetIteratorDirect: drive an iterator by its own `next`, without asking for `[Symbol.iterator]`. */
  iterateDirect(value: Value, node?: AstNode): Cursor {
    if (value instanceof IteratorObj) return value.cursor
    if (!(value instanceof Obj)) {
      throw typeError(`An iterator must be an object, received ${describeValue(value)}.`, node)
    }
    return this.customCursor(
      {
        iterator: value,
        next: requireIteratorMethod(get(value, "next"), "Iterator next", node),
        asynchronous: false,
      },
      node,
    )
  }

  private customCursor(iterator: CustomIterator, node: AstNode | undefined): Cursor {
    return {
      next: () => this.nextIteratorResult(iterator, node),
      close: () => this.closeIterator(iterator, node),
    }
  }

  private *customIterator(
    value: Value,
    node: AstNode | undefined,
    allowAsync = true,
  ): Eval<CustomIterator | undefined> {
    if (!(value instanceof Obj)) return undefined
    const asyncMethod = allowAsync ? get(value, AsyncIteratorSymbol) : undefined
    const method = asyncMethod ?? get(value, IteratorSymbol)
    if (method === undefined || method === null) return undefined
    const iterator = yield* this.call(requireIteratorMethod(method, "Iterator method", node), value, [], node)
    const object = requireIteratorObject(iterator, "Iterator method result", node)
    return {
      iterator: object,
      next: requireIteratorMethod(get(object, "next"), "Iterator next", node),
      asynchronous: asyncMethod !== undefined && asyncMethod !== null,
    }
  }

  private *nextIteratorResult(iterator: CustomIterator, node: AstNode | undefined): Eval<Step> {
    const called = yield* this.call(iterator.next, iterator.iterator, [], node)
    const object = requireIteratorObject(
      iterator.asynchronous ? yield* this.awaitValue(called, node) : called,
      "Iterator next() result",
      node,
    )
    return { done: Boolean(get(object, "done")), value: get(object, "value") }
  }

  private *closeIterator(iterator: CustomIterator, node: AstNode | undefined): Eval<void> {
    const close = get(iterator.iterator, "return")
    if (close === undefined || close === null) return
    const method = requireIteratorMethod(close, "Iterator return", node)
    const called = yield* this.call(method, iterator.iterator, [], node)
    requireIteratorObject(
      iterator.asynchronous ? yield* this.awaitValue(called, node) : called,
      "Iterator return() result",
      node,
    )
  }

  // Yield `value` and continue with the request that resumes the body: `next` supplies the value of the `yield`,
  // `throw` throws there, and `return` unwinds through `finally` blocks (an async generator awaits the value first).
  private *suspendGenerator(value: Value, asynchronous: boolean): Eval<Value> {
    const request = (yield new Yield(value)) as GeneratorRequest
    if (request.kind === "next") return request.value
    if (request.kind === "throw") throw new Throw(request.value)
    throw new GeneratorReturn(asynchronous ? yield* this.awaitValue(request.value) : request.value)
  }

  *delegateYield(value: Value, node: AstNode, asynchronous: boolean): Eval<Value> {
    const builtin = builtinCursor(this.ctx.builtins, value)
    if (builtin !== undefined && !asynchronous) {
      while (true) {
        const step = yield* builtin.next()
        if (step.done) return undefined
        try {
          yield* this.suspendGenerator(step.value, asynchronous)
        } catch (error) {
          if (error instanceof GeneratorReturn) {
            yield* builtin.close()
            throw error
          }
          if (error instanceof Throw) {
            yield* builtin.close()
            throw typeError("The delegated iterator does not provide a throw() method.", node)
          }
          throw error
        }
      }
    }

    const custom = builtin === undefined ? yield* this.customIterator(value, node, asynchronous) : undefined
    if (builtin === undefined && !custom) throw typeError("yield* requires a compatible iterable value.", node)
    // An async generator delegates to a synchronous iterator through CreateAsyncFromSyncIterator, as JS does.
    const iterator = asynchronous && !custom?.asynchronous ? this.asyncFromSync(builtin, custom, node) : custom!
    let kind: GeneratorRequest["kind"] = "next"
    let input: Value = undefined
    while (true) {
      const method = kind === "next" ? iterator.next : get(iterator.iterator, kind)
      if (method === undefined || method === null) {
        if (kind === "return") throw new GeneratorReturn(asynchronous ? yield* this.awaitValue(input, node) : input)
        yield* this.closeIterator(iterator, node)
        throw typeError("The delegated iterator does not provide a throw() method.", node)
      }
      const called = yield* this.call(
        requireIteratorMethod(method, `Iterator ${kind}`, node),
        iterator.iterator,
        [input],
        node,
      )
      const result = requireIteratorObject(
        iterator.asynchronous ? yield* this.awaitValue(called, node) : called,
        `Iterator ${kind}() result`,
        node,
      )
      const done = Boolean(get(result, "done"))
      const resultValue = get(result, "value")
      if (done) {
        if (kind === "return") throw new GeneratorReturn(resultValue)
        return resultValue
      }

      try {
        // Delegated values are yielded as they are; an async generator's inner promise already settled them.
        input = yield* this.suspendGenerator(resultValue, asynchronous)
        kind = "next"
      } catch (error) {
        if (!(error instanceof GeneratorReturn) && !(error instanceof Throw)) throw error
        kind = error instanceof GeneratorReturn ? "return" : "throw"
        input = error.value
      }
    }
  }
}

// The async-from-sync adapter still keeps its iterator in host closures, so its methods are made per iteration.
const asyncFromSyncMethod = (builtins: Builtins, name: string, call: NativeCall) =>
  native(builtins, { name, length: 1, call, runtime: "async-from-sync" })

// Finishes a built-in's work, locating a failure at the call that started it.
function* located(work: Eval<Value>, node: AstNode | undefined): Eval<Value> {
  try {
    return yield* work
  } catch (error) {
    throw locate(error, node)
  }
}

// Lets the host run first, then starts the work.
function* afterSlice(start: () => Value | Eval<Value>): Eval<Value> {
  yield Slice
  const result = start()
  return isEval(result) ? yield* result : result
}
