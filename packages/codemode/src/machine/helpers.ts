import { type AstNode, typeError } from "../interpreter/model.js"
import { type Cursor, Helper, Obj, type Step, type Value } from "../interpreter/objects.js"
import { describeValue } from "../interpreter/references.js"
import { Interruption } from "../interpreter/signals.js"
import { type Frame, kind, type Out, PENDING } from "./frame.js"
import { iterate, iterateDirect, iteratorClose, iteratorStep } from "./iteration.js"
import type { MachineTask } from "./task.js"

// Iterator helpers (`map`, `filter`, `take`, `drop`, `flatMap`) as frames over a `Helper` record. A helper's own
// failures are not located here: a built-in that drives it (`Iterator.prototype.next`) locates them at its call, as
// a statement that drives it leaves them.

const finished: Step = { done: true, value: undefined }
const site = undefined as unknown as AstNode

// The phases of `next`: start, have the source's step, have the callback's result (map, filter, flatMap), have the
// inner iterator, have the inner step, have the source closed (take), and closing the source after a callback failed.
const START = 0
const STEPPED = 1
const CALLED = 2
const FLATTENED = 3
const INNER = 4
const TAKEN = 5
const GUARD_CLOSING = 6
const GUARD_CLOSED = 7
const DROPPED = 8
const REENTERED = 9

// The phases whose failure closes the source first: the callback, and (flatMap) flattening and the inner iterator.
const guarded = (phase: number) => phase === CALLED || phase === FLATTENED || phase === INNER

/** GetIteratorFlattenable: an iterable by `[Symbol.iterator]`, otherwise the object itself as an iterator. */
export const flattenable = (
  task: MachineTask,
  value: Value,
  name: string,
  strings: boolean,
  node: AstNode,
): Out<Cursor> => {
  if (typeof value === "string" ? !strings : !(value instanceof Obj)) {
    throw typeError(`${name} expects an iterable or iterator, received ${describeValue(value)}.`)
  }
  const mark = task.stack.length
  const opened = iterate(task, value, node)
  if (opened === PENDING) return task.park(undefined, mark, Flatten, node, 1, [value])
  return opened ?? iterateDirect(value, undefined)
}

const Flatten = kind(
  "IteratorFlattenable",
  (_task, frame: Frame, _node, input) =>
    (input as Cursor | undefined) ?? iterateDirect(frame.slots[0] as Value, undefined),
)

// Slots: the helper, and the callback failure the source is closed for.
function nextStep(task: MachineTask, frame: Frame, input: unknown): Out<Step> {
  const helper = frame.slots[0] as Helper
  let phase = frame.phase
  if (phase === GUARD_CLOSING) {
    frame.phase = GUARD_CLOSED
    if (iteratorClose(task, helper.source, site) === PENDING) return PENDING
    phase = GUARD_CLOSED
  }
  if (phase === GUARD_CLOSED) throw frame.slots[1]
  if (phase === START) {
    if (helper.done) return finished
    if (helper.running) {
      frame.phase = REENTERED
      throw typeError("Iterator helper is already running.")
    }
    helper.running = true
  }
  const step = pull(task, frame, helper, phase, input)
  if (step === PENDING) return PENDING
  helper.done = step.done
  helper.running = false
  return step
}

// Advances the helper from `phase`; parks the frame at the next phase whenever the work it started is pending.
function pull(task: MachineTask, frame: Frame, helper: Helper, phase: number, input: unknown): Out<Step> {
  const wait = (next: number): typeof PENDING => {
    frame.phase = next
    return PENDING
  }
  const source = helper.source
  switch (helper.op) {
    case "map": {
      if (phase === START) {
        const step = iteratorStep(task, source, site)
        if (step === PENDING) return wait(STEPPED)
        input = step
        phase = STEPPED
      }
      if (phase === STEPPED) {
        const step = input as Step
        if (step.done) return finished
        frame.phase = CALLED
        const mapped = task.call(helper.callback, undefined, [step.value, helper.count++], site)
        if (mapped === PENDING) return PENDING
        input = mapped
      }
      return { done: false, value: input as Value }
    }
    case "filter": {
      while (true) {
        if (phase === START) {
          frame.phase = START
          const step = iteratorStep(task, source, site)
          if (step === PENDING) return wait(STEPPED)
          input = step
          phase = STEPPED
        }
        if (phase === STEPPED) {
          const step = input as Step
          if (step.done) return finished
          frame.slots[1] = step
          frame.phase = CALLED
          const kept = task.call(helper.callback, undefined, [step.value, helper.count++], site)
          if (kept === PENDING) return PENDING
          input = kept
        }
        if (input) return frame.slots[1] as Step
        phase = START
      }
    }
    case "take": {
      if (phase === TAKEN) return finished
      if (phase === STEPPED) return input as Step
      if (helper.count === 0) {
        if (iteratorClose(task, source, site) === PENDING) return wait(TAKEN)
        return finished
      }
      helper.count -= 1
      const step = iteratorStep(task, source, site)
      if (step === PENDING) return wait(STEPPED)
      return step
    }
    case "drop": {
      if (phase === STEPPED) {
        if ((input as Step).done) return finished
      }
      if (phase === DROPPED) return input as Step
      while (helper.count > 0) {
        helper.count -= 1
        const step = iteratorStep(task, source, site)
        if (step === PENDING) return wait(STEPPED)
        if (step.done) return finished
      }
      const step = iteratorStep(task, source, site)
      if (step === PENDING) return wait(DROPPED)
      return step
    }
    case "flatMap": {
      while (true) {
        if (phase === START && helper.inner !== undefined) {
          frame.phase = INNER
          const step = iteratorStep(task, helper.inner, site)
          if (step === PENDING) return PENDING
          input = step
          phase = INNER
        }
        if (phase === INNER) {
          const step = input as Step
          if (!step.done) return step
          helper.inner = undefined
          phase = START
        }
        if (phase === START) {
          frame.phase = START
          const step = iteratorStep(task, source, site)
          if (step === PENDING) return wait(STEPPED)
          input = step
          phase = STEPPED
        }
        if (phase === STEPPED) {
          const step = input as Step
          if (step.done) return finished
          frame.phase = CALLED
          const mapped = task.call(helper.callback, undefined, [step.value, helper.count++], site)
          if (mapped === PENDING) return PENDING
          input = mapped
          phase = CALLED
        }
        if (phase === CALLED) {
          frame.phase = FLATTENED
          const inner = flattenable(task, input as Value, "Iterator.prototype.flatMap", false, site)
          if (inner === PENDING) return PENDING
          input = inner
        }
        helper.inner = input as Cursor
        phase = START
      }
    }
  }
}

/** A helper's `next`: the step it produces. */
export const HelperNext = kind(
  "IteratorHelper.next",
  (task, frame: Frame, _node, input) => nextStep(task, frame, input),
  {
    unwind: (_task, frame, error) => {
      const helper = frame.slots[0] as Helper
      if (frame.phase === REENTERED) return false
      if (guarded(frame.phase) && !(error instanceof Interruption)) {
        frame.phase = GUARD_CLOSING
        frame.slots[1] = error
        return true
      }
      helper.done = true
      helper.running = false
      // The callback's failure wins over a failing close.
      if (frame.phase === GUARD_CLOSING || frame.phase === GUARD_CLOSED) throw frame.slots[1]
      return false
    },
  },
)

/** A helper's `return`: closes its inner iterator (flatMap) and its source, once. */
export const HelperClose = kind(
  "IteratorHelper.return",
  (task, frame: Frame, _node, _input) => {
    const helper = frame.slots[0] as Helper
    if (frame.phase === 0) {
      if (helper.done) return undefined
      if (helper.running) throw typeError("Iterator helper is already running.")
      helper.running = true
      helper.done = true
      frame.phase = 1
      if (helper.inner !== undefined && iteratorClose(task, helper.inner, site) === PENDING) return PENDING
    }
    if (frame.phase === 1) {
      frame.phase = 2
      if (iteratorClose(task, helper.source, site) === PENDING) return PENDING
    }
    helper.running = false
    return undefined
  },
  {
    unwind: (_task, frame) => {
      if (frame.phase !== 0) (frame.slots[0] as Helper).running = false
      return false
    },
  },
)
