import type { Expression, Super } from "acorn"
import type { Interpreter } from "../interpreter/interpreter.js"
import type { AstNode } from "../interpreter/model.js"
import type { Value } from "../interpreter/objects.js"
import type { ScopeStack } from "../interpreter/scope.js"
import {
  abrupt,
  Await,
  type Completion,
  Enter,
  normal,
  Push,
  type Signal,
  Slice,
  Yield,
} from "../interpreter/signals.js"
import { locate } from "../interpreter/errors.js"
import { Frame, kind, type Kind, PASS, PENDING, type Pending } from "./frame.js"
import { dispatch } from "./calls.js"
import type { Machine } from "./machine.js"

/**
 * Steps run by every machine task in this process, so tests can see that a program ran on the machine; `inspect`, when
 * a test sets it, sees the stack before every step.
 */
export const stats: { steps: number; inspect: ((stack: ReadonlyArray<Frame>) => void) | undefined } = {
  steps: 0,
  inspect: undefined,
}

/**
 * A stack of machine frames and the loop that steps it. The machine runs every job on its root task.
 *
 * The loop answers what frames ask for on the stack itself: an `await` cuts the stack at the innermost async boundary
 * and parks the frames it cut on the promise, a `yield` cuts it at the innermost generator boundary and keeps the
 * frames on the generator, and a body a built-in starts (`Call`, `Push`) or a generator resumes (`Enter`) is pushed.
 * What it cannot answer (host work, a slice, or an `await` or `yield` with no boundary on this stack) it hands to
 * whoever runs it.
 */
export class MachineTask {
  readonly stack: Array<Frame> = []
  /** The scope chain of the frame running now. */
  scopes: ScopeStack
  /** What the running frame asked for; the step loop answers it once the frame parks. */
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

  /** Pushes a fresh frame, which runs next from phase 0. */
  push(kind: Kind, node: AstNode | undefined, slots: Array<unknown> = []): Pending {
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

  /** Asks for `signal`; its answer (or failure) is the result of the frame this pushes. */
  request(signal: Signal, node: AstNode | undefined): Pending {
    this.signal = signal
    this.stack.push(new Frame(passKind, node, PASS, this.scopes, []))
    return PENDING
  }

  /** Puts frames taken off a stack back on this one, counting their calls again. */
  enter(frames: ReadonlyArray<Frame>): void {
    for (const frame of frames) {
      this.stack.push(frame)
      if (frame.kind.counts?.(frame)) this.machine.depth++
    }
  }

  /**
   * Runs the stack from the top frame with `input` until it empties (its last result) or a frame asks for something
   * this stack cannot answer (the signal). A throw that unwinds past the bottom frame is thrown.
   */
  drive(ok: boolean, input: unknown): IteratorResult<Signal, Value> {
    const stack = this.stack
    const machine = this.machine
    let value = input
    while (true) {
      stats.steps++
      if (stats.inspect !== undefined) stats.inspect(stack)
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
          if (frame.kind.counts?.(frame)) machine.depth--
          if (frame.kind.locates) error = locate(error, frame.node)
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
        if (frame.kind.counts?.(frame)) machine.depth--
        value = out
        continue
      }
      value = undefined
      const signal = this.signal
      if (signal !== undefined) {
        this.signal = undefined
        const answer = this.answer(signal)
        if (answer === undefined) return { done: false, value: signal }
        ok = answer.ok
        value = answer.ok ? answer.value : answer.error
        continue
      }
      if (this.slice) {
        this.slice = false
        return { done: false, value: Slice }
      }
    }
  }

  // Answers a signal on this stack, giving what the top frame continues with; undefined hands the signal on.
  private answer(signal: Signal): Completion | undefined {
    const machine = this.machine
    if (signal instanceof Enter) {
      this.enter(signal.frames)
      if (machine.tick()) this.slice = true
      return signal.input
    }
    if (signal instanceof Push) {
      this.stack.push(new Frame(signal.kind, undefined, 0, this.scopes, signal.slots))
      return normal(undefined)
    }
    if (signal instanceof Await) return this.await(signal)
    if (signal instanceof Yield) {
      const stack = this.stack
      for (let index = stack.length - 1; index >= 0; index--) {
        const frame = stack[index]!
        if (frame.kind.yielded !== undefined) return frame.kind.yielded(this, index, signal.value)
      }
    }
    return undefined
  }

  // Cuts the stack at the innermost async boundary and parks the frames cut off on the awaited promise; the frame
  // below the boundary continues with what the boundary gives it (an async function's promise, say).
  private await(signal: Await): Completion | undefined {
    const stack = this.stack
    for (let index = stack.length - 1; index >= 0; index--) {
      const frame = stack[index]!
      const cut = frame.kind.cut?.(frame)
      if (cut === undefined) continue
      let promise
      try {
        promise = this.machine.promiseResolve(signal.value)
      } catch (error) {
        return abrupt(error)
      }
      this.machine.park(this.split(index), promise, signal.node, cut.ok ? (cut.value as Value) : undefined)
      return cut
    }
    return undefined
  }

  /** Takes the frames from `index` up off the stack; their calls no longer count toward its depth. */
  split(index: number): Array<Frame> {
    const frames = this.stack.splice(index)
    for (const frame of frames) if (frame.kind.counts?.(frame)) this.machine.depth--
    return frames
  }
}

// A frame waiting on the answer to a request; the answer passes straight to the frame below.
const passKind = kind("Request", (_task, _frame, _node, input) => input)
