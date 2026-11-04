import type { Expression, Super } from "acorn"
import type { Interpreter } from "../interpreter/interpreter.js"
import type { AstNode } from "../interpreter/model.js"
import type { Value } from "../interpreter/objects.js"
import type { ScopeStack } from "../interpreter/scope.js"
import { type Eval, type Signal, Slice } from "../interpreter/signals.js"
import { Frame, type Kind, PASS, PENDING, type Pending } from "./frame.js"
import { dispatch, native } from "./calls.js"
import type { Machine } from "./machine.js"

/** Steps run by every machine task in this process, so tests can see that a program ran on the machine. */
export const stats = { steps: 0 }

/**
 * A stack of machine frames and the loop that steps it. To the runner it is an activation body, like interpreter
 * work: `next` and `throw` run it until it finishes or needs the driver (`Await`, `Yield`, a host call, a slice, or a
 * call it cannot make on its own stack), and the driver's answer resumes the frame that asked.
 */
export class MachineTask {
  readonly stack: Array<Frame> = []
  /** The scope chain of the frame running now. */
  scopes: ScopeStack
  /** What the running frame asked the driver for; the step loop hands it over once the frame parks. */
  signal: Signal | undefined = undefined
  /** The host should get a turn at the next step boundary. */
  slice = false

  readonly ctx: Interpreter<unknown>

  constructor(
    readonly machine: Machine,
    scopes: ScopeStack,
  ) {
    this.ctx = machine.ctx
    this.scopes = scopes
  }

  [Symbol.iterator]() {
    return this
  }

  next(input?: unknown): IteratorResult<Signal, Value> {
    return this.drive(true, input)
  }

  throw(error: unknown): IteratorResult<Signal, Value> {
    return this.drive(false, error)
  }

  return(value?: Value): IteratorResult<Signal, Value> {
    return { done: true, value }
  }

  /** Pushes a fresh frame, which runs next from phase 0. */
  push(kind: Kind, node: AstNode, slots: Array<unknown> = []): Pending {
    this.stack.push(new Frame(kind, node, 0, this.scopes, slots))
    return PENDING
  }

  /**
   * Leaves a kind function that is waiting on work it started: its frame continues at `phase`. Run inline (no frame
   * yet), the frame is made now and slipped in at `mark`, the stack height when the function began, so it sits below
   * the frames that work pushed.
   */
  park(
    frame: Frame | undefined,
    mark: number,
    kind: Kind,
    node: AstNode,
    phase: number,
    slots: Array<unknown> = [],
  ): Pending {
    if (frame !== undefined) {
      frame.phase = phase
      frame.slots = slots
      return PENDING
    }
    const made = new Frame(kind, node, phase, this.scopes, slots)
    if (mark === this.stack.length) this.stack.push(made)
    else this.stack.splice(mark, 0, made)
    return PENDING
  }

  /** A tail position: the work started gives this frame's result, so a frame of its own only passes it through. */
  tail<A>(frame: Frame | undefined, result: A | Pending): A | Pending {
    if (result === PENDING && frame !== undefined) frame.phase = PASS
    return result
  }

  /** Calls `callable`: a program function pushes a frame; a built-in answers at once or runs as a native frame. */
  call(
    callable: Value,
    thisValue: Value,
    args: Array<Value>,
    node: AstNode | undefined,
    callee?: Expression | Super,
  ): Value | Pending {
    return dispatch(this, callable, thisValue, args, node, callee)
  }

  /** Runs host interpreter work as a native frame; a failure it raises is located at `site` when one is given. */
  native<A>(work: Eval<A>, site: AstNode | undefined, locate: boolean): A | Pending {
    return native(this, work, site, locate)
  }

  /** Asks the driver for `signal`; its answer (or failure) is the result of the frame this pushes. */
  request(signal: Signal, node: AstNode | undefined): Pending {
    this.signal = signal
    this.stack.push(new Frame(passKind, node, PASS, this.scopes, []))
    return PENDING
  }

  private drive(ok: boolean, input: unknown): IteratorResult<Signal, Value> {
    const stack = this.stack
    let value = input
    while (true) {
      stats.steps++
      if (!ok) {
        let error = value
        while (true) {
          const frame = stack[stack.length - 1]
          if (frame === undefined) throw error
          const unwind = frame.kind.unwind
          if (unwind !== undefined) {
            this.scopes = frame.scope
            try {
              if (unwind(this, frame, error)) break
            } catch (thrown) {
              error = thrown
            }
          }
          stack.pop()
        }
        ok = true
        value = undefined
      }
      const frame = stack[stack.length - 1]
      if (frame === undefined) return { done: true, value: value as Value }
      if (frame.phase === PASS) {
        stack.pop()
        continue
      }
      this.scopes = frame.scope
      let out: unknown
      try {
        out = frame.kind.step(this, frame, frame.node, value)
      } catch (error) {
        ok = false
        value = error
        continue
      }
      if (out !== PENDING) {
        stack.pop()
        value = out
        continue
      }
      value = undefined
      const signal = this.signal
      if (signal !== undefined) {
        this.signal = undefined
        return { done: false, value: signal }
      }
      if (this.slice) {
        this.slice = false
        return { done: false, value: Slice }
      }
    }
  }
}

// A frame waiting on the driver's answer to a request; the answer passes straight to the frame below.
const passKind: Kind = { name: "Request", step: (_task, _frame, _node, input) => input }
