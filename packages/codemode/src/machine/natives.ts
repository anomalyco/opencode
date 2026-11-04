import { locate } from "../interpreter/errors.js"
import { type AstNode, GeneratorReturn } from "../interpreter/model.js"
import type { Value } from "../interpreter/objects.js"
import { Interruption } from "../interpreter/signals.js"
import { type Frame, type Out, PENDING } from "./frame.js"
import { type Iter, iterate, iteratorClose, iteratorStep } from "./iteration.js"
import { type Consumer, EXIT, nativeKind, site, SUB } from "./native-kind.js"
import type { MachineTask } from "./task.js"

// Phases: open the iterator, have it, step it, have the step, continue a value's work, close after a failure, closed,
// finished, and closed after stopping early.
const OPENED = 1
const STEP = 2
const STEPPED = 3
const CONSUMING = 4
const CLOSING = 5
const CLOSED = 6
const FINISHED = 7
const EXITED = 8

/**
 * Iterates `source` to its end, handing each value to `consumer`: `Array.from`, the collection constructors,
 * `Object.fromEntries`, and the others that consume an iterable. Slots: the consumer, the source, the iterator, the
 * index, the consumer's place, then the consumer's own state (from `STATE`). A failure in the consumer's work closes
 * the iterator, and wins over a failing close; a failure of the iterator itself does not close it.
 */
export const drain = (consumer: Consumer, source: Value, state: Array<unknown>) =>
  [consumer, source, undefined, 0, 0, ...state] as Array<unknown>

/** `drain`'s slots for an iterator already open (GetIteratorDirect). */
export const drainOpen = (consumer: Consumer, iterator: Iter, state: Array<unknown>) =>
  [consumer, undefined, iterator, 0, 0, ...state] as Array<unknown>

export const Drain = nativeKind(
  "Drain",
  (task, frame, input) => {
    const slots = frame.slots
    const consumer = slots[0] as Consumer
    const node = site(frame)
    let phase = frame.phase
    if (phase === CLOSING) {
      frame.phase = CLOSED
      if (iteratorClose(task, slots[2] as Iter, node) === PENDING) return PENDING
      phase = CLOSED
    }
    if (phase === CLOSED) throw slots[3]
    if (phase === EXITED) {
      frame.phase = FINISHED
      return task.tail(frame, consumer.done(task, frame))
    }
    if (phase === 0 && slots[2] !== undefined) phase = STEP
    if (phase === 0) {
      const opened = iterate(task, slots[1] as Value, node)
      if (opened === PENDING) {
        frame.phase = OPENED
        return PENDING
      }
      input = opened
      phase = OPENED
    }
    if (phase === OPENED) {
      if (input === undefined) {
        frame.phase = FINISHED
        return task.tail(frame, consumer.notIterable!(task, frame, slots[1] as Value))
      }
      slots[2] = input
      phase = STEP
    }
    const iterator = slots[2] as Iter
    if (phase === CONSUMING) {
      const out = consumer.resume!(task, frame, input, slots[3] as number)
      if (out === PENDING) return PENDING
      if (out === EXIT) return exit(task, frame, iterator, node)
      slots[3] = (slots[3] as number) + 1
      phase = STEP
    }
    while (true) {
      if (phase === STEP) {
        frame.phase = STEP
        const step = iteratorStep(task, iterator, node)
        if (step === PENDING) {
          frame.phase = STEPPED
          return PENDING
        }
        input = step
      }
      const step = input as { done: boolean; value: Value }
      if (step.done) {
        frame.phase = FINISHED
        return task.tail(frame, consumer.done(task, frame))
      }
      consumer.take?.(frame, step.value, slots[3] as number)
      if (consumer.each !== undefined) {
        frame.phase = CONSUMING
        slots[SUB] = 0
        const out = consumer.each(task, frame, step.value, slots[3] as number)
        if (out === PENDING) return PENDING
        if (out === EXIT) return exit(task, frame, iterator, node)
      }
      slots[3] = (slots[3] as number) + 1
      phase = STEP
    }
  },
  {
    unwind: (_task, frame, error) => {
      if (frame.phase === CONSUMING && !(error instanceof Interruption)) {
        frame.phase = CLOSING
        frame.slots[3] = locate(error, frame.node)
        return true
      }
      if (frame.phase === CLOSING || frame.phase === CLOSED) {
        // A generator's return() is a return completion, so a failing close wins over it, as after `break`.
        throw frame.slots[3] instanceof GeneratorReturn && !(error instanceof Interruption)
          ? locate(error, frame.node)
          : frame.slots[3]
      }
      throw locate(error, frame.node)
    },
  },
)

// Stops early: closes the iterator (a failure to close is the result), then the consumer makes the result.
function exit(task: MachineTask, frame: Frame, iterator: Iter, node: AstNode): Out<Value> {
  frame.phase = EXITED
  if (iteratorClose(task, iterator, node) === PENDING) return PENDING
  frame.phase = FINISHED
  return task.tail(frame, (frame.slots[0] as Consumer).done(task, frame))
}
