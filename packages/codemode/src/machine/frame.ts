import type { AstNode } from "../interpreter/model.js"
import type { ScopeStack } from "../interpreter/scope.js"
import type { Completion } from "../interpreter/signals.js"
import type { MachineTask } from "./task.js"

/**
 * What a kind function returns when it could not finish within this step: it pushed frames above its own (a program
 * call, say), or parked its own frame to wait for the driver. Its frame continues when they deliver a result.
 */
export const PENDING: unique symbol = Symbol("codemode.pending")
export type Pending = typeof PENDING
export type Out<A> = A | Pending

/**
 * One frame kind: the step that runs a frame of this kind from its phase, and the handler a thrown completion meets
 * while unwinding through it. Kinds are module constants, so a frame names its kind by `name` once it is serialized.
 *
 * `step(task, frame, node, input)` runs from `frame.phase` with `input`, the result of whatever ran above it. Called
 * with no frame it is evaluating inline, from phase 0: it either finishes, or parks a frame of its own at the place
 * where the work it started sits on the stack.
 *
 * `unwind(task, frame, error)` returns true when the frame takes the throw and continues (its phase says how);
 * false, or a throw of its own, pops it and the throw goes on.
 */
export type Kind = {
  readonly name: string
  // Method syntax, so each kind's step can name the node type it evaluates and the input it receives.
  step(task: MachineTask, frame: Frame | undefined, node: AstNode | undefined, input: unknown): unknown
  unwind?(task: MachineTask, frame: Frame, error: unknown): boolean
  /**
   * Whether the frame is an async boundary, where an `await` above cuts the stack: what the frame below receives once
   * the frames from this one up are parked on the awaited promise, or undefined when the frame is no boundary.
   */
  cut?(frame: Frame): Completion | undefined
  /** Whether the frame counts toward the call-depth limit while it is on the stack. */
  counts?(frame: Frame): boolean
  /** A frame of this kind holds a host generator (a built-in that calls program code), so it cannot be saved. */
  readonly opaque?: boolean
}

/** The phase of a frame that only passes its input through to the frame below: a tail position. */
export const PASS = -1

/**
 * One activation record of the machine: which kind of work, the node it evaluates, how far it got (`phase`), its
 * partial results (`slots`), and the scope chain it runs in, which becomes current again whenever it runs.
 */
export class Frame {
  constructor(
    public kind: Kind,
    public node: AstNode | undefined,
    public phase: number,
    public scope: ScopeStack,
    public slots: Array<unknown>,
  ) {}
}

export const kind = (
  name: string,
  step: Kind["step"],
  options?: Pick<Kind, "unwind" | "cut" | "counts" | "opaque">,
): Kind => ({
  name,
  step,
  ...options,
})
