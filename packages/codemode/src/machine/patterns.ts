import type { ArrayPattern, AssignmentPattern, MemberExpression, ObjectPattern, Pattern } from "acorn"
import { enumerableSource } from "../stdlib/object.js"
import { type AstNode, GeneratorReturn, typeError, unsupportedSyntax } from "../interpreter/model.js"
import { Arr, assign, Obj, Position, type Step, type Value } from "../interpreter/objects.js"
import {
  assignToReference,
  destructuredProperty,
  propertyKey,
  readReference,
  writableReference,
} from "../interpreter/operations.js"
import { describeValue } from "../interpreter/references.js"
import { Interruption } from "../interpreter/signals.js"
import { type Frame, kind, type Out, PENDING } from "./frame.js"
import { toPropertyKey } from "./calls.js"
import { ev, member, named } from "./expressions.js"
import { type Iter, iterate, iteratorClose, iteratorStep } from "./iteration.js"
import type { MachineTask } from "./task.js"

/** How a pattern binds: declaring names (a `let`, a parameter) or assigning to existing targets. */
export type Mode = { readonly declare: boolean; readonly mutable: boolean; readonly initialize: boolean }

export const assigning: Mode = { declare: false, mutable: true, initialize: false }
const declarations: ReadonlyArray<Mode> = [
  { declare: true, mutable: false, initialize: false },
  { declare: true, mutable: false, initialize: true },
  { declare: true, mutable: true, initialize: false },
  { declare: true, mutable: true, initialize: true },
]

/** Declares names: `initialize` fills bindings reserved for the temporal dead zone instead of making new ones. */
export const declaring = (mutable: boolean, initialize: boolean): Mode =>
  declarations[(mutable ? 2 : 0) + (initialize ? 1 : 0)]!

/** Binds `value` to `pattern`; `context` is the declaration or element errors about a name are located at. */
export function bind(task: MachineTask, pattern: Pattern, value: Value, context: AstNode, mode: Mode): Out<undefined> {
  switch (pattern.type) {
    case "Identifier": {
      const scopes = task.scopes
      if (!mode.declare) scopes.set(pattern.name, value, pattern)
      else if (mode.initialize) scopes.initialize(pattern.name, value, context)
      else scopes.declare(pattern.name, value, mode.mutable, context)
      return undefined
    }
    case "MemberExpression":
      if (!mode.declare) return writeMember(task, undefined, pattern, undefined, value)
      break
    case "AssignmentPattern":
      return assignmentPattern(task, undefined, pattern, undefined, [value, context, mode])
    case "ObjectPattern":
      return objectPattern(task, undefined, pattern, undefined, [value, context, mode])
    case "ArrayPattern":
      return arrayPattern(task, undefined, pattern, undefined, [value, context, mode])
  }
  if (mode.declare) throw typeError(`Unsupported binding pattern '${pattern.type}'.`, pattern)
  throw typeError(`Unsupported assignment pattern '${pattern.type}'.`, context)
}

// Assigning to a member reads the current value first, as every member write does, then writes.
function writeMember(
  task: MachineTask,
  frame: Frame | undefined,
  node: MemberExpression,
  input: unknown,
  value = frame?.slots[0] as Value,
): Out<undefined> {
  const mark = task.stack.length
  let reference = input
  if (frame === undefined) {
    reference = member(task, undefined, node, undefined, false)
    if (reference === PENDING) return task.park(frame, mark, MemberWrite, node, 1, [value])
  }
  const target = writableReference(reference as Parameters<typeof writableReference>[0], node)
  readReference(target, node)
  assignToReference(target.target, target.key, value, node)
  return undefined
}

const MemberWrite = kind("MemberWrite", writeMember)

// Slots: the value, the context, and the mode. A default applies only to undefined, and an anonymous function default
// takes the target's name.
function assignmentPattern(
  task: MachineTask,
  frame: Frame | undefined,
  pattern: AssignmentPattern,
  input: unknown,
  slots = frame!.slots,
): Out<undefined> {
  const mark = task.stack.length
  let value = slots[0] as Value
  if (frame !== undefined) value = input as Value
  else if (value === undefined) {
    const resolved =
      pattern.left.type === "Identifier" ? named(task, pattern.right, pattern.left.name) : ev(task, pattern.right)
    if (resolved === PENDING) return task.park(frame, mark, Default, pattern, 1, slots)
    value = resolved
  }
  return task.tail(frame, bind(task, pattern.left, value, slots[1] as AstNode, slots[2] as Mode))
}

const Default = kind("AssignmentPattern", assignmentPattern)

// Slots: the value, the context, the mode, the next property, and the keys taken so far (for a rest element).
// Phases: 0 starts the property at the index, 1 has its computed key, 2 has the key converted.
function objectPattern(
  task: MachineTask,
  frame: Frame | undefined,
  pattern: ObjectPattern,
  input: unknown,
  slots = frame!.slots,
): Out<undefined> {
  const mark = task.stack.length
  const value = slots[0] as Value
  const mode = slots[2] as Mode
  let phase = frame?.phase ?? 0
  if (frame === undefined) {
    if (value === null || value === undefined) {
      throw typeError(`Cannot destructure ${describeValue(value)} as it is ${value}.`, pattern)
    }
    slots = [value, slots[1], mode, 0, new Set<PropertyKey>()]
  }
  const consumed = slots[4] as Set<PropertyKey>
  const properties = pattern.properties
  while ((slots[3] as number) < properties.length) {
    const index = slots[3] as number
    const property = properties[index]!
    if (property.type === "RestElement") {
      slots[3] = index + 1
      const rest = new Obj(task.ctx.builtins.Object)
      assign(rest, enumerableSource(task.ctx, "Object destructuring", value, pattern), consumed)
      if (bind(task, property.argument, rest, property, mode) === PENDING)
        return task.park(frame, mark, ObjectPatternKind, pattern, 0, slots)
      continue
    }
    let key: PropertyKey
    if (phase === 0) {
      if (property.type !== "Property" || property.kind !== "init") {
        throw typeError("Unsupported object destructuring property.", property)
      }
      const keyNode = property.key
      if (property.computed) {
        const computed = ev(task, keyNode)
        if (computed === PENDING) return task.park(frame, mark, ObjectPatternKind, pattern, 1, slots)
        input = computed
        phase = 1
      } else if (keyNode.type === "Identifier") key = keyNode.name
      else if (keyNode.type === "Literal") key = String(keyNode.value)
      else throw unsupportedSyntax(keyNode.type, keyNode)
    }
    if (phase === 1) {
      const converted = toPropertyKey(task, input as Value, property.key)
      if (converted === PENDING) return task.park(frame, mark, ObjectPatternKind, pattern, 2, slots)
      input = converted
      phase = 2
    }
    if (phase === 2) key = propertyKey(input as Value)
    phase = 0
    consumed.add(typeof key! === "symbol" ? key : String(key!))
    slots[3] = index + 1
    const item = destructuredProperty(task.ctx.builtins, value, key!, property)
    if (bind(task, property.value, item, property, mode) === PENDING)
      return task.park(frame, mark, ObjectPatternKind, pattern, 0, slots)
  }
  return undefined
}

const ObjectPatternKind = kind("ObjectPattern", objectPattern)

// The phases of an array pattern: open the iterator, start the element at the index, receive its step, bind it (the
// region where a failure closes the iterator), collect a rest element, and close after a failure and rethrow it.
const OPEN = 1
const ELEMENT = 2
const STEPPED = 3
const BINDING = 4
const REST = 5
const FAILING = 6
const FAILED = 7

// Slots: the value, the context, the mode, the iterator, the next element, whether the iterator is done, the rest
// values, and the failure being rethrown.
function arrayPattern(
  task: MachineTask,
  frame: Frame | undefined,
  pattern: ArrayPattern,
  input: unknown,
  slots = frame!.slots,
): Out<undefined> {
  const mark = task.stack.length
  const mode = slots[2] as Mode
  let phase = frame?.phase ?? 0
  if (phase === 0) {
    slots = [slots[0], slots[1], mode, undefined, 0, false, undefined, undefined]
    const opened = iterate(task, slots[0] as Value, pattern)
    if (opened === PENDING) return task.park(frame, mark, ArrayPatternKind, pattern, OPEN, slots)
    input = opened
    phase = OPEN
  }
  if (phase === OPEN) {
    if (input === undefined) throw typeError("Array destructuring requires a supported iterable value.", pattern)
    slots[3] = input
    phase = ELEMENT
    // An iterator with something to close needs a frame, so a failure while binding can close it.
    if (frame === undefined && !(input instanceof Position))
      return task.park(frame, mark, ArrayPatternKind, pattern, ELEMENT, slots)
  }
  if (phase === FAILING) return fail(task, frame!, pattern)
  if (phase === FAILED) throw slots[7]
  const iterator = slots[3] as Iter
  const elements = pattern.elements
  while (true) {
    if (phase === ELEMENT) {
      const index = slots[4] as number
      if (index >= elements.length) {
        if (slots[5]) return undefined
        return task.tail(frame, iteratorClose(task, iterator, pattern))
      }
      const element = elements[index]
      if (slots[5]) {
        slots[4] = index + 1
        if (element === null) continue
        const rest = element.type === "RestElement"
        const target = rest ? element.argument : element
        const result = bind(task, target, rest ? new Arr(task.ctx.builtins.Array) : undefined, element, mode)
        if (rest) return task.tail(frame, result)
        if (result === PENDING) return task.park(frame, mark, ArrayPatternKind, pattern, ELEMENT, slots)
        continue
      }
      const step = iteratorStep(task, iterator, pattern)
      if (step === PENDING) return task.park(frame, mark, ArrayPatternKind, pattern, STEPPED, slots)
      input = step
      phase = STEPPED
    }
    if (phase === STEPPED) {
      const step = input as Step
      const index = slots[4] as number
      const element = elements[index]!
      slots[5] = step.done
      if (element === null) {
        slots[4] = index + 1
        phase = ELEMENT
        continue
      }
      if (element.type === "RestElement") {
        slots[6] = step.done ? [] : [step.value]
        phase = REST
        input = undefined
      } else {
        slots[4] = index + 1
        // A failure binding a value the iterator produced closes it; after the iterator is done there is nothing to
        // close.
        if (frame !== undefined) frame.phase = step.done ? ELEMENT : BINDING
        const result = bind(task, element, step.done ? undefined : step.value, pattern, mode)
        if (result === PENDING)
          return task.park(frame, mark, ArrayPatternKind, pattern, step.done ? ELEMENT : BINDING, slots)
        if (frame !== undefined) frame.phase = ELEMENT
        phase = ELEMENT
        continue
      }
    }
    if (phase === BINDING) {
      phase = ELEMENT
      continue
    }
    if (phase === REST) {
      const rest = slots[6] as Array<Value>
      if (input !== undefined) {
        const step = input as Step
        slots[5] = step.done
        if (!step.done) rest.push(step.value)
      }
      while (!slots[5]) {
        const step = iteratorStep(task, iterator, pattern)
        if (step === PENDING) return task.park(frame, mark, ArrayPatternKind, pattern, REST, slots)
        slots[5] = step.done
        if (!step.done) rest.push(step.value)
      }
      const element = elements[slots[4] as number]!
      if (frame !== undefined) frame.phase = ELEMENT
      return task.tail(
        frame,
        bind(task, (element as { argument: Pattern }).argument, new Arr(task.ctx.builtins.Array, rest), element, mode),
      )
    }
    return undefined
  }
}

// IteratorClose after a failure while binding: the failure wins over a failing close, except that a generator's
// return() is a return completion, so a failing close wins over it.
function fail(task: MachineTask, frame: Frame, pattern: ArrayPattern): Out<undefined> {
  const failure = frame.slots[7]
  let closed: Out<undefined>
  try {
    closed = iteratorClose(task, frame.slots[3] as Iter, pattern)
  } catch (error) {
    if (failure instanceof GeneratorReturn) throw error
    throw failure
  }
  if (closed === PENDING) {
    frame.phase = FAILED
    return PENDING
  }
  throw failure
}

const ArrayPatternKind = kind("ArrayPattern", arrayPattern, {
  unwind: (_task, frame, error) => {
    if (frame.phase === FAILED) {
      if (frame.slots[7] instanceof GeneratorReturn) return false
      throw frame.slots[7]
    }
    if (frame.phase !== BINDING || error instanceof Interruption) return false
    frame.slots[7] = error
    frame.phase = FAILING
    return true
  },
})
