import type {
  ArrayExpression,
  AssignmentExpression,
  AwaitExpression,
  BinaryExpression,
  CallExpression,
  ChainExpression,
  ConditionalExpression,
  Expression,
  ImportExpression,
  LogicalExpression,
  MemberExpression,
  NewExpression,
  ObjectExpression,
  SequenceExpression,
  TaggedTemplateExpression,
  TemplateLiteral,
  UnaryExpression,
  UpdateExpression,
  YieldExpression,
} from "acorn"
import { ToolReference } from "../tool-runtime.js"
import { constructRegExp } from "../stdlib/regexp.js"
import { enumerableSource } from "../stdlib/object.js"
import { compoundOperators } from "../stdlib/value.js"
import { locate } from "../interpreter/errors.js"
import { checkStringLength } from "../interpreter/limits.js"
import {
  AsyncIteratorSymbol,
  GeneratorReturn,
  invalidData,
  IteratorSymbol,
  OptionalShortCircuit,
  PendingThrow,
  Throw,
  typeError,
  unsupportedSyntax,
} from "../interpreter/model.js"
import {
  Arr,
  assign,
  Builtin,
  coerceToNumber,
  coerceToString,
  define,
  type NativeResult,
  Obj,
  remove,
  type Value,
} from "../interpreter/objects.js"
import {
  applyBinaryOperator,
  assignToReference,
  createFunction,
  instanceofValue,
  isAnonymousFunction,
  literal,
  type MemberReference,
  notConstructible,
  propertyKey,
  readReference,
  requireMemberBase,
  resolveProperty,
  templateObject,
  writableReference,
} from "../interpreter/operations.js"
import { capability } from "../interpreter/promises.js"
import { isOpaque, typeofValue } from "../interpreter/references.js"
import { Await, type GeneratorRequest, isEval, Yield } from "../interpreter/signals.js"
import { type Frame, kind, type Out, PENDING, type Pending } from "./frame.js"
import { operate, toPrimitive, toPropertyKey } from "./calls.js"
import { spread } from "./iteration.js"
import { assigning, bind } from "./patterns.js"
import type { MachineTask } from "./task.js"

type Reference = MemberReference | ToolReference | { value: Value } | typeof OptionalShortCircuit

/**
 * Evaluates an expression. Leaves and anything that cannot run program code finish here, within one step and without
 * a frame; work that calls program code leaves frames on the stack and returns `PENDING`.
 */
export function ev(task: MachineTask, node: Expression): Out<Value> {
  switch (node.type) {
    case "Literal": {
      const regex = node.regex
      if (regex) return constructRegExp(task.ctx.builtins, [regex.pattern, regex.flags])
      return literal(node)
    }
    case "Identifier":
      return task.scopes.get(node.name, node)
    case "ThisExpression":
      return task.scopes.get("this", node)
    case "ArrowFunctionExpression":
    case "FunctionExpression":
      return createFunction(task.ctx.builtins, task.scopes, node)
    case "BinaryExpression":
      return binaryExpression(task, undefined, node, undefined)
    case "LogicalExpression":
      return logicalExpression(task, undefined, node, undefined)
    case "UnaryExpression":
      return unaryExpression(task, undefined, node, undefined)
    case "AssignmentExpression":
      return assignmentExpression(task, undefined, node, undefined)
    case "UpdateExpression":
      return updateExpression(task, undefined, node, undefined)
    case "SequenceExpression":
      return sequenceExpression(task, undefined, node)
    case "CallExpression":
      return callExpression(task, undefined, node, undefined)
    case "MemberExpression":
      return member(task, undefined, node, undefined, true) as Out<Value>
    case "ChainExpression":
      return chainExpression(task, undefined, node, undefined)
    case "ObjectExpression":
      return objectExpression(task, undefined, node, undefined)
    case "ArrayExpression":
      return arrayExpression(task, undefined, node, undefined)
    case "TemplateLiteral":
      return templateLiteral(task, undefined, node, undefined)
    case "TaggedTemplateExpression":
      return taggedTemplate(task, undefined, node, undefined)
    case "ConditionalExpression":
      return conditionalExpression(task, undefined, node, undefined)
    case "AwaitExpression":
      return awaitExpression(task, undefined, node, undefined)
    case "YieldExpression":
      return yieldExpression(task, undefined, node, undefined)
    case "NewExpression":
      return newExpression(task, undefined, node, undefined)
    case "ImportExpression":
      return importExpression(task, undefined, node, undefined)
    default:
      throw unsupportedSyntax(node.type, node)
  }
}

/** NamedEvaluation: an anonymous function definition takes the name of what it is assigned to. */
export const named = (task: MachineTask, node: Expression, name: string): Out<Value> =>
  isAnonymousFunction(node) ? createFunction(task.ctx.builtins, task.scopes, node, name) : ev(task, node)

function binaryExpression(
  task: MachineTask,
  frame: Frame | undefined,
  node: BinaryExpression,
  input: unknown,
): Out<Value> {
  const mark = task.stack.length
  const phase = frame?.phase ?? 0
  let left: Value
  if (phase === 0) {
    if (node.left.type === "PrivateIdentifier") throw unsupportedSyntax(node.left.type, node.left)
    const evaluated = ev(task, node.left)
    if (evaluated === PENDING) return task.park(frame, mark, Binary, node, 1)
    left = evaluated
  } else left = phase === 1 ? (input as Value) : (frame!.slots[0] as Value)
  let right: Value
  if (phase <= 1) {
    const evaluated = ev(task, node.right)
    if (evaluated === PENDING) return task.park(frame, mark, Binary, node, 2, [left])
    right = evaluated
  } else right = input as Value
  const operator = node.operator
  if (operator === "instanceof") return instanceofValue(left, right, node)
  if (left instanceof Obj || right instanceof Obj) return task.tail(frame, operate(task, operator, left, right, node))
  return applyBinaryOperator(operator, left, right, node)
}

const Binary = kind("BinaryExpression", binaryExpression)

function logicalExpression(
  task: MachineTask,
  frame: Frame | undefined,
  node: LogicalExpression,
  input: unknown,
): Out<Value> {
  let left = input as Value
  if (frame === undefined) {
    const mark = task.stack.length
    const evaluated = ev(task, node.left)
    if (evaluated === PENDING) return task.park(frame, mark, Logical, node, 1)
    left = evaluated
  }
  const operator = node.operator
  if (operator === "&&") return left ? task.tail(frame, ev(task, node.right)) : left
  if (operator === "||") return left ? left : task.tail(frame, ev(task, node.right))
  if (operator === "??") return left !== null && left !== undefined ? left : task.tail(frame, ev(task, node.right))
  throw typeError(`Unsupported logical operator '${operator}'.`, node)
}

const Logical = kind("LogicalExpression", logicalExpression)

function unaryExpression(task: MachineTask, frame: Frame | undefined, node: UnaryExpression, input: unknown) {
  const mark = task.stack.length
  const phase = frame?.phase ?? 0
  const operator = node.operator
  const argument = node.argument
  let value = input as Value
  if (phase === 0) {
    if (operator === "delete") return deleteExpression(task, undefined, node, undefined)
    // Undeclared names short-circuit, but declared TDZ bindings must still throw.
    if (operator === "typeof" && argument.type === "Identifier" && !task.scopes.resolve(argument.name)) {
      return "undefined"
    }
    const evaluated = ev(task, argument)
    if (evaluated === PENDING) return task.park(frame, mark, Unary, node, 1)
    value = evaluated
  }
  if (phase <= 1) {
    if (operator === "typeof") return typeofValue(value)
    if (operator === "!") return !value
    if (operator === "void") return undefined
    const operand = toPrimitive(task, value, "number", node)
    if (operand === PENDING) return task.park(frame, mark, Unary, node, 2)
    value = operand
  }
  if (isOpaque(value)) {
    throw invalidData("Unary operators require data values.", node)
  }
  switch (operator) {
    case "+":
      return +(value as number)
    case "-":
      return -(value as number)
    case "~":
      return ~(value as number)
    default:
      throw typeError(`Unsupported unary operator '${operator}'.`, node)
  }
}

const Unary = kind("UnaryExpression", unaryExpression)

function deleteExpression(task: MachineTask, frame: Frame | undefined, node: UnaryExpression, input: unknown) {
  const mark = task.stack.length
  const argument = node.argument
  const target = argument.type === "ChainExpression" ? argument.expression : argument
  if (target.type === "Identifier") throw typeError("Only data fields may be deleted.", argument)
  // `delete <non-reference>` evaluates the operand and is true, as in JS.
  if (target.type !== "MemberExpression") {
    if (frame !== undefined) return true
    if (ev(task, target) === PENDING) return task.park(frame, mark, Delete, node, 1)
    return true
  }
  let reference = input as Reference
  if (frame === undefined) {
    const resolved = member(task, undefined, target, undefined, false) as Out<Reference>
    if (resolved === PENDING) return task.park(frame, mark, Delete, node, 1)
    reference = resolved
  }
  if (reference === OptionalShortCircuit) return true
  if (reference instanceof ToolReference || "value" in reference || reference.receiver !== reference.target) {
    throw invalidData("Only data fields may be deleted.", target)
  }
  if (remove(reference.target, reference.key)) return true
  throw typeError(`Cannot delete property '${String(reference.key)}'.`, target)
}

const Delete = kind("DeleteExpression", deleteExpression)

/**
 * A member expression: its value when `read`, otherwise its reference (what a call, assignment, or `delete` needs).
 * GetValue applies ToObject to the base before ToPropertyKey, so a nullish base throws before the key's own toString
 * runs.
 */
export function member(
  task: MachineTask,
  frame: Frame | undefined,
  node: MemberExpression,
  input: unknown,
  read: boolean,
): Out<Value | Reference> {
  const mark = task.stack.length
  const phase = frame?.phase ?? 0
  const kind = read ? MemberRead : MemberReferenceKind
  let object: Value
  if (phase === 0) {
    const objectNode = node.object
    if (objectNode.type === "Super") throw unsupportedSyntax(objectNode.type, objectNode)
    if (node.property.type === "PrivateIdentifier") throw unsupportedSyntax(node.property.type, node.property)
    const evaluated = ev(task, objectNode)
    if (evaluated === PENDING) return task.park(frame, mark, kind, node, 1)
    object = evaluated
  } else object = phase === 1 ? (input as Value) : (frame!.slots[0] as Value)
  let key: Value
  if (phase <= 1) {
    if (object === OptionalShortCircuit) return OptionalShortCircuit
    if ((object === null || object === undefined) && node.optional) return OptionalShortCircuit
    const property = node.property as Expression
    if (!node.computed && property.type === "Identifier") key = property.name
    else {
      const evaluated = ev(task, property)
      if (evaluated === PENDING) return task.park(frame, mark, kind, node, 2, [object])
      key = evaluated
    }
  } else key = input as Value
  if (phase <= 2) {
    requireMemberBase(node, object, key)
    if (key instanceof Obj) {
      const converted = toPrimitive(task, key, "string", node.property)
      if (converted === PENDING) return task.park(frame, mark, kind, node, 3, [object])
      key = converted
    }
  }
  const reference = resolveProperty(task.ctx.builtins, object, propertyKey(key), node.object, node.property)
  if (!read) return reference
  if (reference instanceof ToolReference) return reference
  if ("value" in reference) return reference.value
  return readReference(reference, node)
}

const MemberRead = kind("MemberExpression", (task, frame, node: MemberExpression, input) =>
  member(task, frame, node, input, true),
)
const MemberReferenceKind = kind("MemberReference", (task, frame, node: MemberExpression, input) =>
  member(task, frame, node, input, false),
)

/** The callee a member reference gives a call: its value, and its base object as `this`. */
const method = (reference: Reference, node: MemberExpression): { callable: Value; thisValue: Value } => {
  if (reference === OptionalShortCircuit) return { callable: OptionalShortCircuit, thisValue: undefined }
  if (reference instanceof ToolReference) return { callable: reference, thisValue: undefined }
  if ("value" in reference) return { callable: reference.value, thisValue: undefined }
  return { callable: readReference(reference, node), thisValue: reference.receiver }
}

function sequenceExpression(task: MachineTask, frame: Frame | undefined, node: SequenceExpression) {
  const mark = task.stack.length
  const expressions = node.expressions
  const last = expressions.length - 1
  for (let index = frame === undefined ? 0 : (frame.slots[0] as number) + 1; index < last; index++) {
    if (ev(task, expressions[index]!) === PENDING) return task.park(frame, mark, Sequence, node, 1, [index])
  }
  return task.tail(frame, ev(task, expressions[last]!))
}

const Sequence = kind("SequenceExpression", sequenceExpression)

function chainExpression(task: MachineTask, frame: Frame | undefined, node: ChainExpression, input: unknown) {
  let value = input as Value
  if (frame === undefined) {
    const mark = task.stack.length
    const evaluated = ev(task, node.expression)
    if (evaluated === PENDING) return task.park(frame, mark, Chain, node, 1)
    value = evaluated
  }
  return value === OptionalShortCircuit ? undefined : value
}

const Chain = kind("ChainExpression", chainExpression)

function conditionalExpression(
  task: MachineTask,
  frame: Frame | undefined,
  node: ConditionalExpression,
  input: unknown,
): Out<Value> {
  let test = input as Value
  if (frame === undefined) {
    const mark = task.stack.length
    const evaluated = ev(task, node.test)
    if (evaluated === PENDING) return task.park(frame, mark, Conditional, node, 1)
    test = evaluated
  }
  return task.tail(frame, ev(task, test ? node.consequent : node.alternate))
}

const Conditional = kind("ConditionalExpression", conditionalExpression)

// EvaluateCall: a member callee supplies its base object as `this`; anything else calls with undefined.
// Slots once the callee is known: the callable and `this`.
function callExpression(task: MachineTask, frame: Frame | undefined, node: CallExpression, input: unknown) {
  const mark = task.stack.length
  const phase = frame?.phase ?? 0
  const callee = node.callee
  let target: { callable: Value; thisValue: Value }
  if (phase === 0) {
    if (callee.type === "Super") throw unsupportedSyntax(callee.type, callee)
    if (callee.type === "MemberExpression") {
      const reference = member(task, undefined, callee, undefined, false) as Out<Reference>
      if (reference === PENDING) return task.park(frame, mark, CallExpressionKind, node, 1)
      target = method(reference, callee)
    } else {
      const callable = ev(task, callee)
      if (callable === PENDING) return task.park(frame, mark, CallExpressionKind, node, 2)
      target = { callable, thisValue: undefined }
    }
  } else if (phase === 1) target = method(input as Reference, callee as MemberExpression)
  else if (phase === 2) target = { callable: input as Value, thisValue: undefined }
  else target = { callable: frame!.slots[0] as Value, thisValue: frame!.slots[1] as Value }
  const callable = target.callable
  let args: Array<Value>
  if (phase <= 2) {
    if (callable === OptionalShortCircuit) return OptionalShortCircuit
    if ((callable === null || callable === undefined) && node.optional) return OptionalShortCircuit
    const evaluated = argumentList(task, undefined, node, undefined)
    if (evaluated === PENDING) return task.park(frame, mark, CallExpressionKind, node, 3, [callable, target.thisValue])
    args = evaluated
  } else args = input as Array<Value>
  return task.tail(frame, task.call(callable, target.thisValue, args, node, callee as Expression))
}

const CallExpressionKind = kind("CallExpression", callExpression)

// Slots: the arguments so far and the index of the one being evaluated.
function argumentList(
  task: MachineTask,
  frame: Frame | undefined,
  node: CallExpression | NewExpression,
  input: unknown,
): Out<Array<Value>> {
  const mark = task.stack.length
  const nodes = node.arguments
  let args: Array<Value> = []
  let index = 0
  if (frame !== undefined) {
    args = frame.slots[0] as Array<Value>
    index = frame.slots[1] as number
    if (nodes[index]!.type === "SpreadElement") for (const value of input as Array<Value>) args.push(value)
    else args.push(input as Value)
    index++
  }
  for (; index < nodes.length; index++) {
    const argument = nodes[index]!
    if (argument.type === "SpreadElement") {
      const values = spread(task, argument, "Spread arguments require a synchronous iterable.")
      if (values === PENDING) return task.park(frame, mark, Arguments, node, 1, [args, index])
      for (const value of values) args.push(value)
      continue
    }
    const value = ev(task, argument)
    if (value === PENDING) return task.park(frame, mark, Arguments, node, 1, [args, index])
    args.push(value)
  }
  return args
}

const Arguments = kind("Arguments", argumentList)

// Slots once the callee is known: the constructor.
function newExpression(task: MachineTask, frame: Frame | undefined, node: NewExpression, input: unknown) {
  const mark = task.stack.length
  const phase = frame?.phase ?? 0
  let callee = input as Value
  if (phase === 0) {
    const evaluated = ev(task, node.callee as Expression)
    if (evaluated === PENDING) return task.park(frame, mark, New, node, 1)
    callee = evaluated
  } else if (phase === 2) callee = frame!.slots[0] as Value
  let args: Array<Value>
  if (phase <= 1) {
    const construct = callee instanceof Builtin ? callee.construct : undefined
    if (construct === undefined) throw notConstructible(callee, node)
    const evaluated = argumentList(task, undefined, node, undefined)
    if (evaluated === PENDING) return task.park(frame, mark, New, node, 2, [callee])
    args = evaluated
  } else args = input as Array<Value>
  const constructor = callee as Builtin
  let result: NativeResult
  try {
    result = constructor.construct!(args, constructor, node)
  } catch (error) {
    throw locate(error, node)
  }
  return isEval(result) ? task.tail(frame, task.native(result, node, true)) : result
}

const New = kind("NewExpression", newExpression)

const shouldAssign = (operator: string, current: Value): boolean =>
  operator === "??=" ? current === null || current === undefined : operator === "||=" ? !current : Boolean(current)

const logicalAssignment = (operator: string) => operator === "??=" || operator === "||=" || operator === "&&="

function assignmentExpression(
  task: MachineTask,
  frame: Frame | undefined,
  node: AssignmentExpression,
  input: unknown,
): Out<Value> {
  const mark = task.stack.length
  const phase = frame?.phase ?? 0
  const left = node.left
  const operator = node.operator
  const park = (next: number, slots?: Array<unknown>): Pending => task.park(frame, mark, Assignment, node, next, slots)
  const logical = logicalAssignment(operator)
  if (!logical && operator !== "=" && !compoundOperators.has(operator)) {
    throw typeError(`Unsupported assignment operator '${operator}'.`, node)
  }
  if (left.type === "Identifier") {
    const name = left.name
    if (operator === "=" || logical) {
      if (phase === 1) return task.scopes.set(name, input as Value, left)
      if (logical) {
        const current = task.scopes.get(name, left)
        if (!shouldAssign(operator, current)) return current
      }
      const right = named(task, node.right, name)
      if (right === PENDING) return park(1)
      return task.scopes.set(name, right, left)
    }
    // The binary operator a compound assignment applies: `+=` is `+`.
    const binary = operator.slice(0, -1)
    let next: Value
    if (phase <= 1) {
      let current: Value
      let right: Value
      if (phase === 0) {
        current = task.scopes.get(name, left)
        const evaluated = ev(task, node.right)
        if (evaluated === PENDING) return park(1, [current])
        right = evaluated
      } else {
        current = frame!.slots[0] as Value
        right = input as Value
      }
      if (current instanceof Obj || right instanceof Obj) {
        const result = operate(task, binary, current, right, node)
        if (result === PENDING) return park(2)
        next = result
      } else next = applyBinaryOperator(binary, current, right, node)
    } else next = input as Value
    return task.scopes.set(name, next, left)
  }
  if (operator === "=" && (left.type === "ObjectPattern" || left.type === "ArrayPattern")) {
    let right: Value
    if (phase === 0) {
      const evaluated = ev(task, node.right)
      if (evaluated === PENDING) return park(1)
      right = evaluated
    } else right = phase === 1 ? (input as Value) : (frame!.slots[0] as Value)
    if (phase <= 1 && bind(task, left, right, node, assigning) === PENDING) return park(2, [right])
    return right
  }
  if (left.type !== "MemberExpression") {
    throw typeError("Assignment target must be an Identifier or MemberExpression.", left)
  }
  // Resolve side-effecting object and key expressions exactly once, read the current value, then write.
  // Slots: the reference and the current value.
  let reference: MemberReference
  let current: Value
  if (phase <= 1) {
    let resolved = input as Reference
    if (phase === 0) {
      const evaluated = member(task, undefined, left, undefined, false) as Out<Reference>
      if (evaluated === PENDING) return park(1)
      resolved = evaluated
    }
    reference = writableReference(resolved, left)
    current = readReference(reference, left)
    if (logical && !shouldAssign(operator, current)) return current
  } else {
    reference = frame!.slots[0] as MemberReference
    current = frame!.slots[1] as Value
  }
  let next: Value
  if (phase <= 2) {
    let right = input as Value
    if (phase <= 1) {
      const evaluated = ev(task, node.right)
      if (evaluated === PENDING) return park(2, [reference, current])
      right = evaluated
    }
    if (operator === "=" || logical) next = right
    else {
      const result = operate(task, operator.slice(0, -1), current, right, node)
      if (result === PENDING) return park(3, [reference, current])
      next = result
    }
  } else next = input as Value
  assignToReference(reference.target, reference.key, next, left)
  return next
}

const Assignment = kind("AssignmentExpression", assignmentExpression)

function updateExpression(task: MachineTask, frame: Frame | undefined, node: UpdateExpression, input: unknown) {
  const mark = task.stack.length
  const phase = frame?.phase ?? 0
  const operator = node.operator
  const argument = node.argument
  const increment = operator === "++" ? 1 : operator === "--" ? -1 : undefined
  if (increment === undefined) {
    throw typeError(`Unsupported update operator '${operator}'.`, node)
  }
  // CodeMode numeric coercion, not host Number(), so opaque runtime references reject clearly.
  const operand = (current: Value): number => {
    if (isOpaque(current)) {
      throw invalidData(`'${operator}' requires a data value.`, argument)
    }
    return coerceToNumber(current)
  }
  if (argument.type === "Identifier") {
    let current = input as Value
    if (phase === 0) {
      const value = task.scopes.get(argument.name, argument)
      const converted = value instanceof Obj ? toPrimitive(task, value, "number", argument) : value
      if (converted === PENDING) return task.park(frame, mark, Update, node, 1)
      current = converted
    }
    const before = operand(current)
    const next = before + increment
    task.scopes.set(argument.name, next, argument)
    return node.prefix ? next : before
  }
  if (argument.type !== "MemberExpression") {
    throw typeError("Update target must be an Identifier or MemberExpression.", argument)
  }
  let reference: MemberReference
  let current = input as Value
  if (phase <= 1) {
    let resolved = input as Reference
    if (phase === 0) {
      const evaluated = member(task, undefined, argument, undefined, false) as Out<Reference>
      if (evaluated === PENDING) return task.park(frame, mark, Update, node, 1)
      resolved = evaluated
    }
    reference = writableReference(resolved, argument)
    const converted = toPrimitive(task, readReference(reference, argument), "number", argument)
    if (converted === PENDING) return task.park(frame, mark, Update, node, 2, [reference])
    current = converted
  } else reference = frame!.slots[0] as MemberReference
  const value = operand(current)
  const next = value + increment
  assignToReference(reference.target, reference.key, next, argument)
  return node.prefix ? next : value
}

const Update = kind("UpdateExpression", updateExpression)

// Slots: the object and the index of the property being evaluated, and its key once known. Phases: 0 starts the
// property, 1 has a spread value, 2 has a computed key, 3 has it converted, 4 has the property's value.
function objectExpression(task: MachineTask, frame: Frame | undefined, node: ObjectExpression, input: unknown) {
  const mark = task.stack.length
  const ctx = task.ctx
  let phase = frame?.phase ?? 0
  const object = frame === undefined ? new Obj(ctx.builtins.Object) : (frame.slots[0] as Obj)
  let index = frame === undefined ? 0 : (frame.slots[1] as number)
  let key = frame?.slots[2] as PropertyKey
  const park = (next: number): Pending => task.park(frame, mark, ObjectKind, node, next, [object, index, key])
  const properties = node.properties
  for (; index < properties.length; index++, phase = 0) {
    const property = properties[index]!
    if (property.type === "SpreadElement") {
      let spread = input as Value
      if (phase === 0) {
        const evaluated = ev(task, property.argument)
        if (evaluated === PENDING) return park(1)
        spread = evaluated
      }
      if (spread === null || spread === undefined) continue
      assign(object, enumerableSource(ctx, "Object spread", spread, property))
      continue
    }
    if (phase === 0) {
      if (property.kind !== "init") {
        throw typeError("Only init object properties are supported.", property)
      }
      const keyNode = property.key
      if (property.computed) {
        const evaluated = ev(task, keyNode)
        if (evaluated === PENDING) return park(2)
        input = evaluated
        phase = 2
      } else if (keyNode.type === "Identifier") key = keyNode.name
      else if (keyNode.type === "Literal") key = propertyKey(literal(keyNode))
      else throw typeError("Unsupported object property key shape.", keyNode)
    }
    if (phase === 2) {
      const converted = toPropertyKey(task, input as Value, property.key)
      if (converted === PENDING) return park(3)
      input = converted
      phase = 3
    }
    if (phase === 3) key = propertyKey(input as Value)
    let value = input as Value
    if (phase !== 4) {
      const name =
        key === IteratorSymbol
          ? "[Symbol.iterator]"
          : key === AsyncIteratorSymbol
            ? "[Symbol.asyncIterator]"
            : String(key)
      const evaluated = named(task, property.value as Expression, name)
      if (evaluated === PENDING) return park(4)
      value = evaluated
    }
    define(object, key, value)
  }
  return object
}

const ObjectKind = kind("ObjectExpression", objectExpression)

// Slots: the values so far and the index of the element being evaluated.
function arrayExpression(task: MachineTask, frame: Frame | undefined, node: ArrayExpression, input: unknown) {
  const mark = task.stack.length
  const elements = node.elements
  let values: Array<Value> = []
  let index = 0
  if (frame !== undefined) {
    values = frame.slots[0] as Array<Value>
    index = frame.slots[1] as number
    if (elements[index]!.type === "SpreadElement") for (const value of input as Array<Value>) values.push(value)
    else values.push(input as Value)
    index++
  }
  for (; index < elements.length; index++) {
    const element = elements[index]!
    if (element === null) {
      // A literal elision is a real hole, like JS: extend length without an own index.
      values.length += 1
      continue
    }
    if (element.type === "SpreadElement") {
      const spreadValues = spread(task, element, "Array spread requires a synchronous iterable.")
      if (spreadValues === PENDING) return task.park(frame, mark, ArrayKind, node, 1, [values, index])
      for (const value of spreadValues) values.push(value)
      continue
    }
    const value = ev(task, element)
    if (value === PENDING) return task.park(frame, mark, ArrayKind, node, 1, [values, index])
    values.push(value)
  }
  return new Arr(task.ctx.builtins.Array, values)
}

const ArrayKind = kind("ArrayExpression", arrayExpression)

// Slots: the output so far and the index of the substitution. Phases: 0 appends the quasi at the index, 1 has the
// substitution's value, 2 has it converted.
function templateLiteral(task: MachineTask, frame: Frame | undefined, node: TemplateLiteral, input: unknown) {
  const mark = task.stack.length
  const quasis = node.quasis
  const expressions = node.expressions
  let phase = frame?.phase ?? 0
  let output = frame === undefined ? "" : (frame.slots[0] as string)
  let index = frame === undefined ? 0 : (frame.slots[1] as number)
  for (; index < quasis.length; index++, phase = 0) {
    if (phase === 0) {
      const quasi = quasis[index]!
      // acorn only omits `cooked` for invalid escapes, which are a parse error outside a tagged template.
      if (typeof quasi.value.cooked !== "string") {
        throw typeError("Invalid template literal quasi.", quasi)
      }
      output += quasi.value.cooked
      checkStringLength(output.length)
      if (index >= expressions.length) continue
      const evaluated = ev(task, expressions[index]!)
      if (evaluated === PENDING) return task.park(frame, mark, Template, node, 1, [output, index])
      input = evaluated
      phase = 1
    }
    if (phase === 1) {
      const converted = toPrimitive(task, input as Value, "string", expressions[index]!)
      if (converted === PENDING) return task.park(frame, mark, Template, node, 2, [output, index])
      input = converted
    }
    output += coerceToString(input as Value)
    checkStringLength(output.length)
  }
  return output
}

const Template = kind("TemplateLiteral", templateLiteral)

// `tag\`a${x}b\`` is `tag(strings, x)`: the tag is read like a callee (a member keeps its receiver), the
// substitutions are evaluated in order, and `strings` carries the escaped source as `strings.raw`.
// Slots once the tag is known: the callable, `this`, the values so far, and the index being evaluated.
function taggedTemplate(task: MachineTask, frame: Frame | undefined, node: TaggedTemplateExpression, input: unknown) {
  const mark = task.stack.length
  const phase = frame?.phase ?? 0
  const tag = node.tag
  let target: { callable: Value; thisValue: Value }
  if (phase === 0) {
    if (tag.type === "MemberExpression") {
      const reference = member(task, undefined, tag, undefined, false) as Out<Reference>
      if (reference === PENDING) return task.park(frame, mark, Tagged, node, 1)
      target = method(reference, tag)
    } else {
      const callable = ev(task, tag)
      if (callable === PENDING) return task.park(frame, mark, Tagged, node, 2)
      target = { callable, thisValue: undefined }
    }
  } else if (phase === 1) target = method(input as Reference, tag as MemberExpression)
  else if (phase === 2) target = { callable: input as Value, thisValue: undefined }
  else target = { callable: frame!.slots[0] as Value, thisValue: frame!.slots[1] as Value }
  const strings = templateObject(task.ctx, node)
  const expressions = node.quasi.expressions
  let values: Array<Value> = []
  let index = 0
  if (phase === 3) {
    values = frame!.slots[2] as Array<Value>
    index = frame!.slots[3] as number
    values.push(input as Value)
    index++
  }
  for (; index < expressions.length; index++) {
    const value = ev(task, expressions[index]!)
    if (value === PENDING) {
      return task.park(frame, mark, Tagged, node, 3, [target.callable, target.thisValue, values, index])
    }
    values.push(value)
  }
  return task.tail(frame, task.call(target.callable, target.thisValue, [strings, ...values], node, tag))
}

const Tagged = kind("TaggedTemplateExpression", taggedTemplate)

// Await always suspends, including for plain values: the driver parks the body until the value settles.
function awaitExpression(task: MachineTask, frame: Frame | undefined, node: AwaitExpression, input: unknown) {
  let value = input as Value
  if (frame === undefined) {
    const mark = task.stack.length
    const evaluated = ev(task, node.argument)
    if (evaluated === PENDING) return task.park(frame, mark, AwaitKind, node, 1)
    value = evaluated
  }
  return task.tail(frame, task.request(new Await(value, node), node))
}

const AwaitKind = kind("AwaitExpression", awaitExpression)

// Yield `value` and continue with the request that resumes the body: `next` supplies the value of the `yield`,
// `throw` throws there, and `return` unwinds through `finally` blocks (an async generator awaits the value first, as
// it awaits what it yields). Phases: 1 has the argument, 2 has it awaited, 3 has the request, 4 has a return value
// awaited.
function yieldExpression(task: MachineTask, frame: Frame | undefined, node: YieldExpression, input: unknown) {
  const mark = task.stack.length
  const fn = task.scopes.fn
  if (fn === undefined || !fn.generator) throw typeError("yield is only valid inside a generator.", node)
  const asynchronous = fn.async
  let phase = frame?.phase ?? 0
  if (phase === 0) {
    const argument = node.argument
    const evaluated = argument ? ev(task, argument) : undefined
    if (evaluated === PENDING) return task.park(frame, mark, YieldKind, node, 1)
    input = evaluated
    phase = 1
  }
  if (phase === 1) {
    if (node.delegate) {
      return task.tail(frame, task.native(task.ctx.delegateYield(input as Value, node, asynchronous), node, false))
    }
    if (asynchronous) {
      task.request(new Await(input as Value, node), node)
      return task.park(frame, mark, YieldKind, node, 2)
    }
    phase = 2
  }
  if (phase === 2) {
    task.request(new Yield(input as Value), node)
    return task.park(frame, mark, YieldKind, node, 3)
  }
  if (phase === 4) throw new GeneratorReturn(input as Value)
  const request = input as GeneratorRequest
  if (request.kind === "next") return request.value
  if (request.kind === "throw") throw new Throw(request.value)
  if (!asynchronous) throw new GeneratorReturn(request.value)
  task.request(new Await(request.value, undefined), node)
  return task.park(frame, mark, YieldKind, node, 4)
}

const YieldKind = kind("YieldExpression", yieldExpression)

// A module that fails to load rejects the promise, as a failed dynamic import does.
// Slots once the specifier is known: the specifier.
function importExpression(task: MachineTask, frame: Frame | undefined, node: ImportExpression, input: unknown) {
  const mark = task.stack.length
  const phase = frame?.phase ?? 0
  let specifier: string
  if (phase <= 1) {
    let source = input as Value
    if (phase === 0) {
      const evaluated = ev(task, node.source)
      if (evaluated === PENDING) return task.park(frame, mark, Import, node, 1)
      source = evaluated
    }
    specifier = coerceToString(source)
    if (node.options && ev(task, node.options) === PENDING) return task.park(frame, mark, Import, node, 2, [specifier])
  } else specifier = frame!.slots[0] as string
  const promise = capability(task.ctx, node)
  try {
    promise.resolve(task.ctx.namespace(specifier, node))
  } catch (error) {
    if (!(error instanceof PendingThrow)) throw error
    promise.reject(error)
  }
  return promise.promise
}

const Import = kind("ImportExpression", importExpression)

