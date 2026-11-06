import type { Expression, MemberExpression, NewExpression, Super } from "acorn"
import { ToolReference } from "../../tool-runtime.js"
import { type AstNode, invalidData, typeError } from "./model.js"
import { checkStringLength } from "./limits.js"
import { locate } from "./errors.js"
import { type Builtins, primitivePrototype } from "./intrinsics.js"
import {
  Arr,
  Builtin,
  Callable,
  type Cursor,
  Fn,
  get,
  has,
  hasOwn,
  hasPrototype,
  IteratorObj,
  keys,
  Obj,
  parseArrayIndex,
  Position,
  PromiseObj,
  set,
  coerceToString,
  type Value,
} from "./objects.js"
import { isOpaque, rejectCircularInsertion, typeofValue } from "./references.js"
import type { Interpreter } from "./interpreter.js"
import { enumerableSource } from "../stdlib/object.js"

// The synchronous semantics the VM's ops share: operators, property references, and the checks around them. Nothing
// here runs program code.

/** The binary operators that convert object operands through ToPrimitive before acting on primitives. */
const primitiveOperators = new Set([
  "+",
  "-",
  "*",
  "/",
  "%",
  "**",
  "<",
  "<=",
  ">",
  ">=",
  "&",
  "|",
  "^",
  "<<",
  ">>",
  ">>>",
])

/** ToPropertyKey on a primitive (or an opaque value, which keeps its built-in string form). */
export const propertyKey = (value: Value): PropertyKey =>
  typeof value === "string" || typeof value === "number" || typeof value === "symbol" ? value : coerceToString(value)

// Native engines name the callee (`search(...).catch is not a function`), including call chains. Returns
// undefined when a link cannot be named, so a chain is either named completely or not at all.
const calleeDescription = (node: Expression | Super | undefined): string | undefined => {
  if (node?.type === "Identifier") return node.name
  if (node?.type === "CallExpression") {
    const target = calleeDescription(node.callee)
    return target === undefined ? undefined : `${target}(...)`
  }
  if (node?.type !== "MemberExpression") return undefined
  const property = node.property
  const key =
    !node.computed && property.type === "Identifier"
      ? property.name
      : property.type === "Literal" && typeof property.value === "string"
        ? property.value
        : undefined
  if (key === undefined) return undefined
  const object = calleeDescription(node.object)
  return object === undefined ? undefined : `${object}.${key}`
}

/** The TypeError for calling a value that is not a function. */
export const notAFunction = (callee: Expression | Super | undefined, node: AstNode | undefined) =>
  typeError(`${calleeDescription(callee) ?? "The called value"} is not a function.`, callee ?? node)

/** The TypeError for `new` on a callee that cannot be constructed. */
export const notConstructible = (callee: Value, node: NewExpression) => {
  // `new` itself is supported, so a non-constructible callee is a TypeError like JS rather than
  // unsupported syntax. Built-ins like Number are real constructors in JS, so do not claim
  // otherwise; say `new` is unsupported for them and point at the plain call.
  const name = calleeDescription(node.callee) ?? "The called value"
  const message =
    callee instanceof Fn
      ? `${name} cannot be constructed: user-defined constructors and classes are not supported. Call it as a function that returns a plain object instead.`
      : callee instanceof Builtin
        ? `new ${name}(...) is not supported; call ${name}(...) without new instead.`
        : `${name} is not a constructor.`
  return typeError(message, node)
}

// OrdinaryHasInstance: walk the left operand's chain looking for the constructor's `prototype`.
export const instanceofValue = (lhs: Value, rhs: Value, node: AstNode): boolean => {
  if (!(rhs instanceof Callable)) {
    throw typeError("The right-hand side of 'instanceof' is not callable.", node)
  }
  const prototype = get(rhs, "prototype")
  if (!(prototype instanceof Obj)) {
    throw typeError("The right-hand side of 'instanceof' has no 'prototype' object.", node)
  }
  return hasPrototype(lhs, prototype)
}

export const applyBinaryOperator = (operator: string, lhs: Value, rhs: Value, node: AstNode): Value => {
  if (operator === "===") return lhs === rhs
  if (operator === "!==") return lhs !== rhs
  if (operator === "==") return looselyEqual(lhs, rhs, node)
  if (operator === "!=") return !looselyEqual(lhs, rhs, node)
  if (operator === "in" && rhs instanceof Obj && !isOpaque(lhs)) return has(rhs, propertyKey(lhs))
  if (isOpaque(lhs) || isOpaque(rhs)) {
    throw invalidData("Binary operators require data values.", node)
  }
  // Object operands were already converted through ToPrimitive; only primitives reach the arithmetic below.
  switch (operator) {
    case "+": {
      const sum = (lhs as string) + (rhs as string)
      if (typeof sum === "string") checkStringLength(sum.length)
      return sum
    }
    case "-":
      return (lhs as number) - (rhs as number)
    case "*":
      return (lhs as number) * (rhs as number)
    case "/":
      return (lhs as number) / (rhs as number)
    case "%":
      return (lhs as number) % (rhs as number)
    case "**":
      return (lhs as number) ** (rhs as number)
    case "<":
      return (lhs as string) < (rhs as string)
    case "<=":
      return (lhs as string) <= (rhs as string)
    case ">":
      return (lhs as string) > (rhs as string)
    case ">=":
      return (lhs as string) >= (rhs as string)
    case "&":
      return (lhs as number) & (rhs as number)
    case "|":
      return (lhs as number) | (rhs as number)
    case "^":
      return (lhs as number) ^ (rhs as number)
    case "<<":
      return (lhs as number) << (rhs as number)
    case ">>":
      return (lhs as number) >> (rhs as number)
    case ">>>":
      return (lhs as number) >>> (rhs as number)
    case "in":
      throw typeError("The 'in' operator requires a data object on the right-hand side.", node)
    default:
      throw typeError(`Unsupported binary operator '${operator}'.`, node)
  }
}

// IsLooselyEqual: objects (including functions and tool references) compare by identity, and a nullish
// primitive never equals an object.
const looselyEqual = (lhs: Value, rhs: Value, node: AstNode): boolean => {
  const lhsObject = lhs !== null && typeof lhs === "object"
  const rhsObject = rhs !== null && typeof rhs === "object"
  if (lhsObject === rhsObject) return lhsObject ? lhs === rhs : lhs == rhs
  const primitive = lhsObject ? rhs : lhs
  if (primitive === null || primitive === undefined) return false
  // Data objects were converted through ToPrimitive, so only an opaque reference facing a primitive gets here.
  throw invalidData("Binary operators require data values.", node)
}

/**
 * How an operator with an object operand converts: `in` with a data object on the left asks ToPropertyKey of it,
 * a converting operator asks ToPrimitive of both operands with `hint`, and anything else needs no conversion.
 */
export const operatorConversion = (
  operator: string,
  lhs: Value,
  rhs: Value,
): { readonly kind: "key" } | { readonly kind: "primitive"; readonly hint: "default" | "number" } | undefined => {
  // `in` checks the right operand before ToPropertyKey on the left, so a bad right side wins over a bad key.
  if (operator === "in" && lhs instanceof Obj && !isOpaque(lhs) && rhs instanceof Obj) return { kind: "key" }
  // IsLooselyEqual converts only an object facing a non-nullish primitive; two objects (including tool
  // references, which are not Obj) compare by identity.
  const equality = operator === "==" || operator === "!="
  const other = lhs instanceof Obj ? rhs : lhs
  const converts =
    primitiveOperators.has(operator) || (equality && other !== null && other !== undefined && typeof other !== "object")
  if (!converts) return undefined
  return { kind: "primitive", hint: operator === "+" || equality ? "default" : "number" }
}

export type { CustomIterator } from "./objects.js"

/** A resolved member: the object to read through and the receiver that inherited accessors see. */
type MemberReference = {
  target: Obj
  key: PropertyKey
  receiver: Value
}

// A thenable the program's implicit async body adopts before copy-out.
export const isThenable = (value: Value): boolean =>
  value instanceof PromiseObj || (value instanceof Obj && typeofValue(get(value, "then")) === "function")

/** A built-in iterator over `value` that needs no program code to start: an iterator object, a string, a collection. */
export const builtinCursor = (builtins: Builtins, value: Value): Cursor | undefined => {
  if (value instanceof IteratorObj) return value.cursor
  if (typeof value === "string") return new Position(value, "values", builtins.Array)
  return value instanceof Obj ? value.iterator(builtins) : undefined
}

export const requireIteratorObject = (value: Value, context: string, node?: AstNode): Obj => {
  if (value instanceof Obj) return value
  throw typeError(`${context} must be an object.`, node)
}

export const requireIteratorMethod = (value: Value, context: string, node?: AstNode): Value => {
  if (typeofValue(value) === "function") return value
  throw typeError(`${context} must be a function.`, node)
}

// for...in over null/undefined iterates nothing, like JS. After the own keys come each prototype's enumerable
// string keys, skipping any key a nearer level has, even as a non-enumerable property.
export const forInKeys = <R>(ctx: Interpreter<R>, value: Value, node: AstNode): Array<string> => {
  if (value instanceof ToolReference) return [...ctx.tools.keys(value.path)]
  if (value === null || value === undefined) return []
  const source = enumerableSource(ctx, "for...in", value, node)
  const chain = [source]
  // A string's characters stand in an array, but its prototype is String.prototype.
  let proto = primitivePrototype(ctx.builtins, value) ?? source.proto
  while (proto !== null) {
    chain.push(proto)
    proto = proto.proto
  }
  return chain.flatMap((target, depth) => {
    const nearer = chain.slice(0, depth)
    return keys(target).filter((key) => !nearer.some((level) => hasOwn(level, key)))
  })
}

// GetValue applies ToObject to the base before ToPropertyKey, so a nullish base throws before the key's own
// toString runs.
export const requireMemberBase = (node: MemberExpression, objectValue: Value, keyValue: Value): void => {
  if (objectValue === null || objectValue === undefined) {
    throw typeError(`Cannot read properties of ${objectValue} (reading '${coerceToString(keyValue)}').`, node.object)
  }
}

export const resolveProperty = (
  builtins: Builtins,
  objectValue: Value,
  key: PropertyKey,
  objectNode: AstNode,
  propertyNode: AstNode,
): MemberReference | ToolReference | { value: Value } => {
  if (objectValue instanceof ToolReference) {
    if (typeof key !== "string") {
      throw typeError("Tool paths must use string property names.", propertyNode)
    }
    return new ToolReference([...objectValue.path, key])
  }

  if (objectValue instanceof Obj) return { target: objectValue, key, receiver: objectValue }

  // Strings own length and indexes; every other primitive property reads through the wrapper prototype.
  if (typeof objectValue === "string") {
    if (key === "length") return { value: objectValue.length }
    const index = typeof key === "symbol" ? undefined : parseArrayIndex(key)
    if (index !== undefined) return { value: objectValue[index] }
  }
  const proto = primitivePrototype(builtins, objectValue)
  if (proto !== undefined) return { target: proto, key, receiver: objectValue }

  if (objectValue === null || objectValue === undefined) {
    throw typeError(`Cannot read properties of ${objectValue} (reading '${String(key)}').`, objectNode)
  }
  throw typeError("Cannot access a property on a non-object value.", objectNode)
}

// One destructured property, read the way a member expression would read it (primitives use their prototype).
export const destructuredProperty = (builtins: Builtins, source: Value, key: PropertyKey, node: AstNode): Value => {
  const reference = resolveProperty(builtins, source, key, node, node)
  if (reference instanceof ToolReference) return reference
  if ("value" in reference) return reference.value
  return readProperty(reference.target, reference.key, node, reference.receiver)
}

export const readReference = (reference: MemberReference, node: MemberExpression): Value => {
  // Reject unknown promise properties so a missing await cannot hide.
  if (reference.target instanceof PromiseObj && !has(reference.target, reference.key)) {
    throw invalidData(
      "This value is an un-awaited Promise; await it first - e.g. `const result = await tools.ns.tool(...)`.",
      node.object,
    )
  }
  return readProperty(reference.target, reference.key, node, reference.receiver)
}

// Accessors throw without a location; the member or pattern that read them supplies it.
export const readProperty = (
  target: Obj,
  key: PropertyKey,
  node: AstNode | undefined,
  receiver: Value = target,
): Value => {
  try {
    return get(target, key, receiver)
  } catch (error) {
    throw locate(error, node)
  }
}

/** The reference an assignment or update writes through: only a data field of an object. */
export const writableReference = (
  reference: MemberReference | ToolReference | { value: Value } | symbol,
  node: MemberExpression,
): MemberReference => {
  if (typeof reference === "symbol" || reference instanceof ToolReference || "value" in reference) {
    throw typeError("Only data fields may be assigned.", node)
  }
  if (reference.receiver !== reference.target) {
    throw typeError(
      `Cannot create property '${String(reference.key)}' on ${typeof reference.receiver} '${String(reference.receiver)}'.`,
      node,
    )
  }
  return reference
}

export const assignToReference = (target: Obj, key: PropertyKey, next: Value, node: AstNode): void => {
  const written = (() => {
    try {
      rejectCircularInsertion(
        target,
        next,
        target instanceof Arr ? "Array assignment result" : "Object assignment result",
      )
      return set(target, key, next)
    } catch (error) {
      throw locate(error, node)
    }
  })()
  if (written) return
  throw typeError(`Cannot assign to read only property '${String(key)}'.`, node)
}
