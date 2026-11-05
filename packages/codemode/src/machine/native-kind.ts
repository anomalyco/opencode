import type { AstNode } from "../interpreter/model.js"
import type { Value } from "../interpreter/objects.js"
import { type Frame, kind, type Kind, type Out, unsealed } from "./frame.js"
import type { MachineTask } from "./task.js"

// Built-ins that call program code run as frames whose state is plain data: a kind (a module constant, named once)
// and the frame's phase and slots. A built-in returns `Push(kind, slots)`; the frame runs at the call site, so a
// failure it raises, or one that unwinds through it, is located there, as a host built-in's would be. This module
// only defines things, so built-ins can make their kinds while the modules they import are still loading.

/** A built-in's frame kind: `step` runs from `frame.phase` with `input`, what the work it started gave back. */
export const nativeKind = (
  name: string,
  step: (task: MachineTask, frame: Frame, input: unknown) => Out<Value>,
  options?: Pick<Kind, "unwind" | "cut" | "counts">,
): Kind => kind(name, (task, frame, _node, input) => step(task, frame!, input), { locates: true, ...options })

/** The call site a built-in's frame runs at, for the operations that report failures there. */
export const site = (frame: Frame) => frame.node as AstNode

/**
 * What a `Drain` (machine/natives.ts) does with each value it pulls. `each` and `resume` may call program code: `each`
 * starts the work for one value, and `resume` continues it with what the work gave back (`frame.slots[SUB]` is theirs
 * for the place it got to); either finishing (anything but `PENDING`) takes the next value, and `EXIT` stops early. A
 * throw from either closes the iterator first. `take` takes a value without closing the iterator when it fails.
 * `done` makes the result once the iterator is exhausted. Consumers are module constants, named once like kinds.
 */
export type Consumer = {
  readonly name: string
  /** What a source that is not iterable gives: usually a TypeError it throws. Not needed when it is known to be. */
  readonly notIterable?: (task: MachineTask, frame: Frame, source: Value) => Out<Value>
  readonly take?: (frame: Frame, value: Value, index: number) => void
  readonly each?: (task: MachineTask, frame: Frame, value: Value, index: number) => Out<unknown>
  readonly resume?: (task: MachineTask, frame: Frame, input: unknown, index: number) => Out<unknown>
  readonly done: (task: MachineTask, frame: Frame) => Out<Value>
}

/** Every consumer, by name, so a saved `Drain` frame can name its consumer. */
export const consumers = new Map<string, Consumer>()

/** Defines a consumer, once per name. */
export const consumer = (made: Consumer): Consumer => {
  unsealed("Consumers", made.name)
  if (consumers.has(made.name)) throw new Error(`Consumer "${made.name}" is defined twice.`)
  consumers.set(made.name, made)
  return made
}

/** What `each` or `resume` returns to stop early: the iterator is closed, then `done` makes the result. */
export const EXIT: unique symbol = Symbol("codemode.exit")

/** The first slot a consumer keeps its own state in. */
export const STATE = 5
/** The slot a consumer keeps its place within one value's work in. */
export const SUB = 4
