import type { AstNode } from "./model.js"
import type { Value } from "./objects.js"
import { Await, type Eval, Invoke } from "./signals.js"

/**
 * Interpreter work for the built-ins that still run as host generators in native frames: calls into the program and
 * iterating. A program function it calls is an `Invoke` the machine runs on its own stack, and a built-in that runs
 * as frames (a generator's `next`) is an `Enter` or `Push` it answers the same way.
 *
 * Phase 3 replaces the built-ins that call program code with the prelude, after which this goes away.
 */
export class Bridge {
  /** Await: suspends the innermost async body until `value` settles. */
  *awaitValue(value: Value, node?: AstNode): Eval<Value> {
    return (yield new Await(value, node)) as Value
  }

  *call(callable: Value, thisValue: Value, args: Array<Value>, node?: AstNode): Eval<Value> {
    return (yield new Invoke(callable, thisValue, args, node)) as Value
  }
}
