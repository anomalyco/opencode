import type { Expression, Identifier, Super } from "acorn"
import { ToolReference } from "../tool-runtime.js"
import { locate } from "../interpreter/errors.js"
import { type AstNode, type Binding, rangeError, typeError } from "../interpreter/model.js"
import {
  Arguments,
  Arr,
  BoundFn,
  Builtin,
  Callable,
  DateObj,
  Fn,
  GeneratorObj,
  get,
  has,
  type NativeResult,
  Obj,
  type Value,
} from "../interpreter/objects.js"
import {
  applyBinaryOperator,
  collectPatternNames,
  hoistVars,
  isSimple,
  notAFunction,
  operatorConversion,
  propertyKey,
  usesArguments,
} from "../interpreter/operations.js"
import { isOpaque } from "../interpreter/references.js"
import { ScopeStack } from "../interpreter/scope.js"
import {
  AsyncBoundary,
  Call,
  type Eval,
  generatorBody,
  Invoke,
  isEval,
  MAX_CALL_DEPTH,
  type Signal,
} from "../interpreter/signals.js"
import type { StatementResult } from "../interpreter/model.js"
import { Frame, kind, type Out, PENDING, type Pending } from "./frame.js"
import { ev } from "./expressions.js"
import type { Machine } from "./machine.js"
import { bind, declaring } from "./patterns.js"
import { blockStatement } from "./statements.js"
import { MachineTask } from "./task.js"

/** The single dispatch for every call the machine makes: call expressions, callbacks, and conversions share it. */
export function dispatch(
  task: MachineTask,
  callable: Value,
  thisValue: Value,
  args: Array<Value>,
  node: AstNode | undefined,
  callee?: Expression | Super,
): Value | Pending {
  if (callable instanceof Fn) return invoke(task, callable, thisValue, args, node)
  if (callable instanceof Builtin) {
    // A loop made only of built-in calls has no program call or loop back-edge to count, so count the call.
    if (task.ctx.runner.tick()) task.slice = true
    // A bound function calls its target directly, so a program target runs as a frame rather than inside a native.
    if (callable instanceof BoundFn) {
      return dispatch(task, callable.target, callable.boundThis, [...callable.boundArgs, ...args], node)
    }
    let result: NativeResult
    try {
      result = callable.invoke(task.ctx, thisValue, args, node)
    } catch (error) {
      throw locate(error, node)
    }
    return isEval(result) ? native(task, result, node, true) : result
  }
  if (callable instanceof ToolReference) {
    if (callable.path.length === 0) throw typeError("The tools root is not callable.", callee ?? node)
    return native(task, task.ctx.toolCall(callable.path, args, node), node, false)
  }
  throw notAFunction(callee, node)
}

// A program call: a synchronous body runs as a counted `Call` frame on this stack. An async body runs as a task of its
// own behind an async boundary, as the runner keeps it today, and the caller receives its promise; a generator call
// binds its parameters on this stack and returns the generator.
function invoke(task: MachineTask, fn: Fn, thisValue: Value, args: Array<Value>, node: AstNode | undefined) {
  const machine = task.machine
  const runner = task.ctx.runner
  if (runner.depth + machine.calls > MAX_CALL_DEPTH) throw rangeError("Maximum call stack size exceeded", node)
  if (runner.tick()) task.slice = true
  if (fn.async && !fn.generator) return task.request(asyncCall(machine, fn, thisValue, args, node), fn.body)
  const counted = !fn.generator
  if (counted) machine.calls++
  return task.push(CallKind, fn.body, [fn, thisValue, args, node, counted, undefined, 0])
}

/** A program call the runner starts as its own activation, so its frame is not counted again. */
export function enter(machine: Machine, invocation: Invoke): Call {
  const fn = invocation.callable as Fn
  const runner = machine.ctx.runner
  if (runner.depth + machine.calls > MAX_CALL_DEPTH) {
    throw rangeError("Maximum call stack size exceeded", invocation.site)
  }
  if (fn.async && !fn.generator) return asyncCall(machine, fn, invocation.thisValue, invocation.args, invocation.site)
  return new Call(callTask(machine, fn, invocation.thisValue, invocation.args, invocation.site))
}

const callTask = (machine: Machine, fn: Fn, thisValue: Value, args: Array<Value>, site: AstNode | undefined) => {
  const task = new MachineTask(machine, new ScopeStack([], fn))
  task.stack.push(new Frame(CallKind, fn.body, 0, task.scopes, [fn, thisValue, args, site, false, undefined, 0]))
  return task
}

// An async function's body is a task behind an async boundary: its completion settles the promise the caller gets.
const asyncCall = (machine: Machine, fn: Fn, thisValue: Value, args: Array<Value>, site: AstNode | undefined) => {
  const body = callTask(machine, fn, thisValue, args, site)
  const runner = machine.ctx.runner
  const promise = runner.newPromise()
  const resolving = runner.resolving(promise)
  return new Call(
    body,
    new AsyncBoundary(
      (completion) =>
        completion.ok ? resolving.resolve(completion.value as Value) : resolving.reject(completion.error),
      promise,
    ),
  )
}

// The phases of a `Call` frame: bind the parameters (resuming at the slot index after a pattern finishes), make the
// generator or start the body, and receive the body's result. A generator's own body task starts at `RUN`.
const ENTER = 0
const BIND = 1
const BODY = 2
const RUN = 3
const RESULT = 4

// Slots: fn, this, args, call site, whether the frame counts toward the depth limit, the parameter scope, and the
// next parameter to bind.
function callStep(task: MachineTask, frame: Frame, _node: AstNode, input: unknown): Out<Value> {
  const slots = frame.slots
  const fn = slots[0] as Fn
  let phase = frame.phase
  if (phase === ENTER) {
    const scopes = activate(task, fn, slots[1] as Value, slots[2] as Array<Value>)
    frame.scope = scopes
    task.scopes = scopes
    slots[5] = scopes.current()
    phase = isSimple(fn.parameters) ? BODY : BIND
  }
  if (phase === BIND) {
    frame.phase = BIND
    if (bindParameters(task, frame) === PENDING) return PENDING
    phase = BODY
  }
  if (phase === BODY && fn.generator) return generator(task, fn, frame)
  if (phase === BODY || phase === RUN) {
    frame.phase = RESULT
    const body = fn.body
    if (body.type === "BlockStatement") {
      task.scopes.push()
      hoistVars(task.scopes, body.body, slots[5] as Map<string, Binding>)
      const result = blockStatement(task, undefined, body, undefined)
      if (result === PENDING) return PENDING
      input = result
    } else {
      const result = ev(task, body)
      if (result === PENDING) return PENDING
      input = result
    }
  }
  if (slots[4]) task.machine.calls--
  if (fn.body.type !== "BlockStatement") return input as Value
  const result = input as StatementResult
  return result.kind === "return" ? result.value : undefined
}

// The activation's scope chain: the closure's scopes and a parameter scope holding `this`, `arguments`, and the
// parameters. `this` and `arguments` are scope bindings so arrows resolve them lexically; a parameter named
// `arguments` shadows the object, as in JS.
const activate = (task: MachineTask, fn: Fn, thisValue: Value, args: Array<Value>): ScopeStack => {
  const scopes = new ScopeStack([...fn.capturedScopes, new Map()], fn)
  const paramScope = scopes.current()
  if (!fn.arrow) paramScope.set("this", { mutable: false, value: thisValue, initialized: true })
  if (!fn.arrow && usesArguments(fn)) {
    paramScope.set("arguments", {
      mutable: true,
      value: new Arguments(task.ctx.builtins.Object, args),
      initialized: true,
    })
  }
  if (isSimple(fn.parameters)) {
    // A repeated name takes the last argument for it, as in JS.
    for (const [index, parameter] of fn.parameters.entries()) {
      paramScope.set((parameter as Identifier).name, { mutable: true, value: args[index], initialized: true })
    }
    return scopes
  }
  // Seed all parameters first so defaults cannot fall through to same-named outer bindings.
  for (const parameter of fn.parameters) {
    for (const name of collectPatternNames(parameter)) {
      paramScope.set(name, { mutable: true, value: undefined, initialized: false })
    }
  }
  return scopes
}

const initializing = declaring(true, true)

function bindParameters(task: MachineTask, frame: Frame): Out<undefined> {
  const slots = frame.slots
  const fn = slots[0] as Fn
  const args = slots[2] as Array<Value>
  const parameters = fn.parameters
  for (let index = slots[6] as number; index < parameters.length; index++) {
    const parameter = parameters[index]!
    if (parameter.type === "RestElement") {
      slots[6] = parameters.length
      const rest = new Arr(task.ctx.builtins.Array, args.slice(index))
      return bind(task, parameter.argument, rest, parameter, initializing)
    }
    if (parameter.type === "Identifier") {
      // A sloppy simple parameter list may repeat a name; the last occurrence wins, as in JS.
      if (parameters.findLastIndex((other) => other.type === "Identifier" && other.name === parameter.name) !== index)
        continue
      task.scopes.initialize(parameter.name, args[index], parameter)
      continue
    }
    slots[6] = index + 1
    if (bind(task, parameter, args[index], parameter, initializing) === PENDING) return PENDING
  }
  return undefined
}

// A generator call returns the generator once its parameters are bound; the body is a task of its own that starts
// with the first `next()`. The prototype is read after the parameters bind, since a default may replace it.
const generator = (task: MachineTask, fn: Fn, frame: Frame): GeneratorObj => {
  const builtins = task.ctx.builtins
  const scopes = frame.scope
  const body = new MachineTask(task.machine, scopes)
  body.stack.push(new Frame(CallKind, fn.body, RUN, scopes, [fn, undefined, undefined, undefined, false, frame.slots[5]]))
  const proto = get(fn, "prototype")
  return new GeneratorObj(
    proto instanceof Obj ? proto : fn.async ? builtins.AsyncGenerator : builtins.Generator,
    fn.async,
    generatorBody(body),
  )
}

export const CallKind = kind("Call", callStep, {
  unwind: (task, frame) => {
    if (frame.slots[4]) task.machine.calls--
    return false
  },
})

// The phases of a native frame: running (or receiving the answer it waits for), throwing a failure into the work, done.
const RUNNING = 0
const THROWING = 1
const FINISHED = 2

/**
 * Runs a built-in's interpreter work as a native frame: program calls it makes (`Invoke`) run as frames on this stack,
 * and anything else it asks for goes to the driver. The frame holds a host generator, so it is opaque.
 */
export function native<A>(task: MachineTask, work: Eval<A>, site: AstNode | undefined, located: boolean): Out<A> {
  const frame = new Frame(Native, site, RUNNING, task.scopes, [work, located, undefined])
  task.stack.push(frame)
  let out: Out<A>
  try {
    out = nativeStep(task, frame, site, undefined) as Out<A>
  } catch (error) {
    task.stack.pop()
    throw error
  }
  if (out !== PENDING) task.stack.pop()
  return out
}

// Slots: the work, whether its failures are located at the call site, and a failure to throw into it.
function nativeStep(task: MachineTask, frame: Frame, site: AstNode | undefined, input: unknown): Out<Value> {
  const slots = frame.slots
  const work = slots[0] as Eval<Value>
  let ok = frame.phase !== THROWING
  let value = ok ? input : slots[2]
  slots[2] = undefined
  frame.phase = RUNNING
  while (true) {
    let result: IteratorResult<Signal, Value>
    try {
      result = ok ? work.next(value) : work.throw(value)
    } catch (error) {
      frame.phase = FINISHED
      throw slots[1] ? locate(error, site) : error
    }
    if (result.done) {
      frame.phase = FINISHED
      return result.value
    }
    const signal = result.value
    if (!(signal instanceof Invoke)) {
      task.signal = signal
      return PENDING
    }
    let out: Out<Value>
    try {
      out = task.call(signal.callable, signal.thisValue, signal.args, signal.site)
    } catch (error) {
      ok = false
      value = error
      continue
    }
    if (out === PENDING) return PENDING
    ok = true
    value = out
  }
}

export const Native = kind("Native", nativeStep, {
  opaque: true,
  unwind: (_task, frame, error) => {
    if (frame.phase === FINISHED) return false
    frame.phase = THROWING
    frame.slots[2] = error
    return true
  },
})

export type Hint = "number" | "string" | "default"

const stringFirst = ["toString", "valueOf"] as const
const numberFirst = ["valueOf", "toString"] as const

const isPrimitive = (value: Value) => value === null || (typeof value !== "object" && typeof value !== "function")

/**
 * ToPrimitive: calls `valueOf`/`toString` in hint order and returns the first primitive result. Dates treat the
 * default hint as "string". Opaque values pass through unchanged so callers reject or describe them in their built-in
 * form. A failure is located at `node`.
 */
export function toPrimitive(task: MachineTask, value: Value, hint: Hint, node: AstNode): Out<Value> {
  if (!(value instanceof Obj) || isOpaque(value)) return value
  return convert(task, undefined, node, undefined, value, hint)
}

// Slots: the value, the hint, and the method being called.
function convert(
  task: MachineTask,
  frame: Frame | undefined,
  node: AstNode,
  input: unknown,
  value = frame?.slots[0] as Obj,
  hint = frame?.slots[1] as Hint,
): Out<Value> {
  const mark = task.stack.length
  let index = 0
  if (frame !== undefined) {
    if (isPrimitive(input as Value)) return input as Value
    index = (frame.slots[2] as number) + 1
  }
  try {
    const methods = hint === "string" || (hint === "default" && value instanceof DateObj) ? stringFirst : numberFirst
    for (; index < methods.length; index++) {
      const callable = get(value, methods[index]!)
      if (!(callable instanceof Callable)) continue
      const result = task.call(callable, value, [], undefined)
      if (result === PENDING) return task.park(frame, mark, ToPrimitive, node, 1, [value, hint, index])
      if (isPrimitive(result)) return result
    }
    throw typeError("Cannot convert object to primitive value.")
  } catch (error) {
    throw locate(error, node)
  }
}

const ToPrimitive = kind("ToPrimitive", (task, frame, node: AstNode, input) => convert(task, frame, node, input), {
  unwind: (_task, frame, error) => {
    throw locate(error, frame.node)
  },
})

/** ToPropertyKey: a data object converts through its own `toString`/`valueOf` first. Apply `propertyKey` to the result. */
export const toPropertyKey = (task: MachineTask, value: Value, node: AstNode): Out<Value> =>
  value instanceof Obj ? toPrimitive(task, value, "string", node) : value

/**
 * A binary operator with an object operand. Arithmetic, relational, and bitwise operators convert both operands first,
 * left then right, so a `valueOf` runs (and throws) in spec order; `+` asks for the default hint and the rest for a
 * number.
 */
export function operate(task: MachineTask, operator: string, lhs: Value, rhs: Value, node: AstNode): Out<Value> {
  if (!(lhs instanceof Obj || rhs instanceof Obj)) return applyBinaryOperator(operator, lhs, rhs, node)
  return operatorStep(task, undefined, node, undefined, [operator, lhs, rhs])
}

// Slots: the operator, both operands, and the converted left operand.
function operatorStep(
  task: MachineTask,
  frame: Frame | undefined,
  node: AstNode,
  input: unknown,
  slots = frame!.slots,
): Out<Value> {
  const mark = task.stack.length
  const operator = slots[0] as string
  const lhs = slots[1] as Value
  const rhs = slots[2] as Value
  const phase = frame?.phase ?? 0
  const conversion = operatorConversion(operator, lhs, rhs)
  if (conversion === undefined) return applyBinaryOperator(operator, lhs, rhs, node)
  if (conversion.kind === "key") {
    const key = phase === 0 ? toPrimitive(task, lhs, "string", node) : input
    if (key === PENDING) return task.park(frame, mark, Operator, node, 1, slots)
    return has(rhs as Obj, propertyKey(key as Value))
  }
  let left: Value
  if (phase === 0) {
    const converted = toPrimitive(task, lhs, conversion.hint, node)
    if (converted === PENDING) return task.park(frame, mark, Operator, node, 2, slots)
    left = converted
  } else left = phase === 2 ? (input as Value) : (slots[3] as Value)
  let right: Value
  if (phase <= 2) {
    const converted = toPrimitive(task, rhs, conversion.hint, node)
    if (converted === PENDING) return task.park(frame, mark, Operator, node, 3, [operator, lhs, rhs, left])
    right = converted
  } else right = input as Value
  return applyBinaryOperator(operator, left, right, node)
}

const Operator = kind("Operator", operatorStep)
