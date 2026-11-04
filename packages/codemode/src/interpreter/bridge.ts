import type { Expression } from "acorn"
import { ToolReference } from "../tool-runtime.js"
import { locate } from "./errors.js"
import type { Interpreter } from "./interpreter.js"
import { type AstNode, IteratorSymbol, typeError } from "./model.js"
import {
  Builtin,
  type Cursor,
  Fn,
  get,
  IteratorObj,
  type NativeResult,
  Obj,
  type Realm,
  type Step,
  type Value,
} from "./objects.js"
import { builtinCursor, notAFunction, requireIteratorMethod, requireIteratorObject } from "./operations.js"
import { describeValue } from "./references.js"
import { Await, Enter, type Eval, Invoke, isEval, Push, Slice } from "./signals.js"

/**
 * Interpreter work for the built-ins that still run as host generators in native frames: calls into the program and
 * iterating. A program function it calls is an `Invoke` the machine runs on its own stack, and a built-in that runs
 * as frames (a generator's `next`) is an `Enter` or `Push` it answers the same way.
 *
 * Phase 3 replaces the built-ins that call program code with the prelude, after which this goes away.
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
    return result instanceof Invoke || result instanceof Enter || result instanceof Push
      ? ((yield result) as Value)
      : result
  }

  // The single dispatch for every call a built-in makes. A program function is an `Invoke` for the machine to run on
  // its stack; a built-in that returns a value needs no generator.
  private dispatch(
    callable: Value,
    thisValue: Value,
    args: Array<Value>,
    node?: AstNode,
    callee?: Expression,
  ): Value | Eval<Value> | Invoke | Enter | Push {
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
  private native(body: () => NativeResult, node?: AstNode): NativeResult {
    let result: NativeResult
    try {
      result = body()
    } catch (error) {
      throw locate(error, node)
    }
    return isEval(result) ? located(result, node) : result
  }

  *iterate(value: Value, node?: AstNode): Eval<Cursor | undefined> {
    const cursor = builtinCursor(this.ctx.builtins, value)
    if (cursor !== undefined) return cursor
    return yield* this.customIterator(value, node)
  }

  /** GetIteratorDirect: drive an iterator by its own `next`, without asking for `[Symbol.iterator]`. */
  iterateDirect(value: Value, node?: AstNode): Cursor {
    if (value instanceof IteratorObj) return value.cursor
    if (!(value instanceof Obj)) {
      throw typeError(`An iterator must be an object, received ${describeValue(value)}.`, node)
    }
    return new CustomCursor(this.ctx, value, requireIteratorMethod(get(value, "next"), "Iterator next", node), node)
  }

  private *customIterator(value: Value, node: AstNode | undefined): Eval<CustomCursor | undefined> {
    if (!(value instanceof Obj)) return undefined
    const method = get(value, IteratorSymbol)
    if (method === undefined || method === null) return undefined
    const iterator = yield* this.call(requireIteratorMethod(method, "Iterator method", node), value, [], node)
    const object = requireIteratorObject(iterator, "Iterator method result", node)
    return new CustomCursor(this.ctx, object, requireIteratorMethod(get(object, "next"), "Iterator next", node), node)
  }
}

/**
 * A program iterator a built-in drives by its own `next`, as data: the iterator, its `next` method, and the call
 * site its failures are located at.
 */
class CustomCursor implements Cursor {
  constructor(
    private readonly realm: Realm,
    readonly iterator: Obj,
    readonly method: Value,
    readonly site: AstNode | undefined,
  ) {}

  *next(): Eval<Step> {
    const object = requireIteratorObject(
      yield* this.realm.call(this.method, this.iterator, [], this.site),
      "Iterator next() result",
      this.site,
    )
    return { done: Boolean(get(object, "done")), value: get(object, "value") }
  }

  *close(): Eval<void> {
    const close = get(this.iterator, "return")
    if (close === undefined || close === null) return
    const method = requireIteratorMethod(close, "Iterator return", this.site)
    requireIteratorObject(
      yield* this.realm.call(method, this.iterator, [], this.site),
      "Iterator return() result",
      this.site,
    )
  }
}

// Finishes a built-in's work, locating a failure at the call that started it.
function* located(work: Eval<Value>, node: AstNode | undefined): Eval<Value> {
  try {
    return yield* work
  } catch (error) {
    throw locate(error, node)
  }
}

// Lets the host run first, then starts the work.
function* afterSlice(start: () => NativeResult): Eval<Value> {
  yield Slice
  const result = start()
  if (isEval(result)) return yield* result
  return result instanceof Enter || result instanceof Push ? ((yield result) as Value) : result
}
