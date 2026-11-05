import type { SpreadElement } from "acorn"
import { AsyncIteratorSymbol, type AstNode, IteratorSymbol, typeError } from "../interpreter/model.js"
import {
  type Cursor,
  type CustomIterator,
  get,
  IteratorObj,
  Obj,
  Position,
  type Step,
  type Value,
} from "../interpreter/objects.js"
import { builtinCursor, requireIteratorMethod, requireIteratorObject } from "../interpreter/operations.js"
import { describeValue } from "../interpreter/references.js"
import { Await } from "../interpreter/signals.js"
import { type Frame, kind, type Out, PENDING, type Pending } from "./frame.js"
import { ev } from "./expressions.js"
import type { MachineTask } from "./task.js"

/** An iterator the machine drives: a built-in cursor, a helper, or a program object with its own `next`. */
export type Iter = Cursor

export const isCustom = (iterator: Iter): iterator is CustomIterator => "iterator" in iterator

/** GetIterator for synchronous iteration: a built-in cursor, or a program iterator from `[Symbol.iterator]()`. */
export const iterate = (task: MachineTask, value: Value, node: AstNode): Out<Iter | undefined> =>
  builtinCursor(task.ctx.builtins, value) ?? openIterator(task, value, node, false)

/** A program iterator from `value`'s `[Symbol.asyncIterator]` (when `allowAsync`) or `[Symbol.iterator]` method. */
export function openIterator(
  task: MachineTask,
  value: Value,
  node: AstNode,
  allowAsync: boolean,
): Out<CustomIterator | undefined> {
  if (!(value instanceof Obj)) return undefined
  const asyncMethod = allowAsync ? get(value, AsyncIteratorSymbol) : undefined
  const method = asyncMethod ?? get(value, IteratorSymbol)
  if (method === undefined || method === null) return undefined
  const asynchronous = asyncMethod !== undefined && asyncMethod !== null
  const mark = task.stack.length
  const iterator = task.call(requireIteratorMethod(method, "Iterator method", node), value, [], node)
  if (iterator === PENDING) return task.park(undefined, mark, IteratorOpen, node, 1, [asynchronous])
  return opened(iterator, asynchronous, node)
}

const opened = (iterator: Value, asynchronous: boolean, node: AstNode): CustomIterator => {
  const object = requireIteratorObject(iterator, "Iterator method result", node)
  return {
    iterator: object,
    next: requireIteratorMethod(get(object, "next"), "Iterator next", node),
    asynchronous,
  }
}

const IteratorOpen = kind("IteratorOpen", (_task, frame: Frame, node: AstNode, input: Value) =>
  opened(input, frame.slots[0] as boolean, node),
)

/** GetIteratorDirect: drive an iterator by its own `next`, without asking for `[Symbol.iterator]`. */
export const iterateDirect = (value: Value, node: AstNode | undefined): Iter => {
  if (value instanceof IteratorObj) return value.cursor
  if (!(value instanceof Obj)) {
    throw typeError(`An iterator must be an object, received ${describeValue(value)}.`, node)
  }
  return {
    iterator: value,
    next: requireIteratorMethod(get(value, "next"), "Iterator next", node),
    asynchronous: false,
  }
}

/** IteratorStep: the next result, as `for...of` sees it. An async iterator's result is awaited first. */
export function iteratorStep(task: MachineTask, iterator: Iter, node: AstNode): Out<Step> {
  if (iterator instanceof Position) return iterator.step()
  return stepStep(task, undefined, node, undefined, iterator)
}

// Slots: the iterator. Phases: call `next`, then (async) await its result, then read it.
function stepStep(
  task: MachineTask,
  frame: Frame | undefined,
  node: AstNode,
  input: unknown,
  iterator = frame?.slots[0] as CustomIterator,
): Out<Step> {
  const mark = task.stack.length
  const phase = frame?.phase ?? 0
  let result = input as Value
  if (phase === 0) {
    const called = task.call(iterator.next, iterator.iterator, [], node)
    if (called === PENDING) return task.park(frame, mark, IteratorStep, node, 1, [iterator])
    result = called
  }
  if (phase <= 1 && iterator.asynchronous) {
    task.request(new Await(result, node), node)
    return task.park(frame, mark, IteratorStep, node, 2, [iterator])
  }
  const object = requireIteratorObject(result, "Iterator next() result", node)
  return { done: Boolean(get(object, "done")), value: get(object, "value") }
}

const IteratorStep = kind("IteratorStep", stepStep)

/** IteratorClose: calls the iterator's `return`, when it has one, and checks what it returned. */
export function iteratorClose(task: MachineTask, iterator: Iter, node: AstNode): Out<undefined> {
  if (iterator instanceof Position) return undefined
  return closeStep(task, undefined, node, undefined, iterator)
}

function closeStep(
  task: MachineTask,
  frame: Frame | undefined,
  node: AstNode,
  input: unknown,
  iterator = frame?.slots[0] as CustomIterator,
): Out<undefined> {
  const mark = task.stack.length
  const phase = frame?.phase ?? 0
  let result = input as Value
  if (phase === 0) {
    const close = get(iterator.iterator, "return")
    if (close === undefined || close === null) return undefined
    const method = requireIteratorMethod(close, "Iterator return", node)
    const called = task.call(method, iterator.iterator, [], node)
    if (called === PENDING) return task.park(frame, mark, IteratorClose, node, 1, [iterator])
    result = called
  }
  if (phase <= 1 && iterator.asynchronous) {
    task.request(new Await(result, node), node)
    return task.park(frame, mark, IteratorClose, node, 2, [iterator])
  }
  requireIteratorObject(result, "Iterator return() result", node)
  return undefined
}

const IteratorClose = kind("IteratorClose", closeStep)

/** A spread element's values, in order; `message` is the TypeError for a value that is not iterable. */
export const spread = (task: MachineTask, node: SpreadElement, message: string): Out<Array<Value>> =>
  spreadStep(task, undefined, node, undefined, message)

// Slots: the message, the values so far, and the iterator. Phases: evaluate the argument, open the iterator, step it.
function spreadStep(
  task: MachineTask,
  frame: Frame | undefined,
  node: SpreadElement,
  input: unknown,
  message = frame?.slots[0] as string,
): Out<Array<Value>> {
  const mark = task.stack.length
  const phase = frame?.phase ?? 0
  const park = (next: number, values?: Array<Value>, iterator?: Iter): Pending =>
    task.park(frame, mark, Spread, node, next, [message, values, iterator])
  let opened: Iter | undefined
  if (phase === 0) {
    const value = ev(task, node.argument)
    if (value === PENDING) return park(1)
    input = value
  }
  if (phase <= 1) {
    const iterator = iterate(task, input as Value, node)
    if (iterator === PENDING) return park(2)
    opened = iterator
  } else opened = phase === 2 ? (input as Iter | undefined) : (frame!.slots[2] as Iter)
  if (opened === undefined) throw typeError(message, node)
  const iterator = opened
  const values = phase === 3 ? (frame!.slots[1] as Array<Value>) : []
  if (phase === 3) {
    const step = input as Step
    if (step.done) return values
    values.push(step.value)
  }
  if (iterator instanceof Position) {
    for (let step = iterator.step(); !step.done; step = iterator.step()) values.push(step.value)
    return values
  }
  while (true) {
    const step = iteratorStep(task, iterator, node)
    if (step === PENDING) return park(3, values, iterator)
    if (step.done) return values
    values.push(step.value)
  }
}

const Spread = kind("Spread", spreadStep)
