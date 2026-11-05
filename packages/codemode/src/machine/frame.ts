import type { AstNode } from "../interpreter/model.js"
import type { Value } from "../interpreter/objects.js"
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
  /**
   * Whether the frame is a generator boundary, where a `yield` above cuts the stack: what the top frame continues with
   * once the boundary at `index` took the yielded `value` (splitting its frames off the stack, or not).
   */
  yielded?(task: MachineTask, index: number, value: Value): Completion
  /** Whether the frame counts toward the call-depth limit while it is on the stack. */
  counts?(frame: Frame): boolean
  /** A failure that unwinds past a frame of this kind is located at its node, where a built-in runs. */
  readonly locates?: boolean
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

/** Every frame kind, by name, so a saved frame can name its kind. */
export const kinds = new Map<string, Kind>()

let sealed = false

/** Closes the kind registry: `machine/kinds.ts` does it once every module that defines one has loaded. */
export const sealKinds = () => {
  sealed = true
}

/** A runtime is made only once the registry is sealed, so the kinds a saved state names are the package's own. */
export const requireSealedKinds = () => {
  if (!sealed) throw new Error("Frame kinds aren't sealed: import src/machine/kinds.ts before making a runtime.")
}

export const kind = (
  name: string,
  step: Kind["step"],
  options?: Pick<Kind, "unwind" | "cut" | "yielded" | "counts" | "locates">,
): Kind => {
  if (sealed) throw new Error(`Frame kinds are sealed: "${name}" can't be registered after Code Mode has loaded.`)
  if (kinds.has(name)) throw new Error(`Frame kind "${name}" is defined twice.`)
  const made = { name, step, ...options }
  kinds.set(name, made)
  return made
}
