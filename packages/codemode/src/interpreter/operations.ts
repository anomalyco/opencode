import type {
  AnyNode,
  ArrowFunctionExpression,
  Expression,
  FunctionDeclaration,
  FunctionExpression,
  ImportDeclaration,
  Literal,
  MemberExpression,
  ModuleDeclaration,
  NewExpression,
  Pattern,
  Statement,
  Super,
  TaggedTemplateExpression,
  VariableDeclaration,
} from "acorn"
import { ToolReference } from "../tool-runtime.js"
import {
  type AstNode,
  type Binding,
  invalidData,
  type StatementResult,
  syntaxError,
  typeError,
  unsupportedSyntax,
} from "./model.js"
import { checkStringLength } from "./limits.js"
import { locate } from "./errors.js"
import { type Builtins, primitivePrototype } from "./intrinsics.js"
import {
  Arr,
  Builtin,
  Callable,
  type Cursor,
  define,
  Fn,
  frozen,
  get,
  getOwn,
  has,
  hasOwn,
  hasPrototype,
  hidden,
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
import type { ScopeStack } from "./scope.js"
import { enumerableSource } from "../stdlib/object.js"

// The synchronous semantics both evaluators share: operators, property references, hoisting, and the checks around
// them. Nothing here runs program code.

/** The binary operators that convert object operands through ToPrimitive before acting on primitives. */
export const primitiveOperators = new Set([
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

export const none: StatementResult = { kind: "none" }

// What a loop does with its body's result: exit with a StatementResult, or undefined to keep iterating.
// Unlabelled break ends this loop; a label the loop does not carry propagates outward.
export const loopExit = (
  result: StatementResult,
  labels: ReadonlySet<string> | undefined,
): StatementResult | undefined => {
  if (result.kind === "return") return result
  if (result.kind === "break") {
    if (result.label !== undefined && !labels?.has(result.label)) return result
    return none
  }
  if (result.kind === "continue" && result.label !== undefined && !labels?.has(result.label)) return result
  return undefined
}

export const isAbrupt = (result: StatementResult): boolean =>
  result.kind === "return" || result.kind === "break" || result.kind === "continue"

// Native engines name the callee (`search(...).catch is not a function`), including call chains. Returns
// undefined when a link cannot be named, so a chain is either named completely or not at all.
export const calleeDescription = (node: Expression | Super | undefined): string | undefined => {
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

// acorn types every literal as possibly a BigInt or RegExp; regex literals become RegExp objects before this is asked.
export const literal = (node: Literal): Value => {
  if (typeof node.value === "bigint") throw typeError("BigInt literals are not supported.", node)
  if (node.value instanceof RegExp) throw unsupportedSyntax("RegExpLiteral", node)
  return node.value
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

export const collectPatternNames = (pattern: Pattern, out: Array<string> = []): Array<string> => {
  switch (pattern.type) {
    case "Identifier":
      out.push(pattern.name)
      break
    case "AssignmentPattern":
      collectPatternNames(pattern.left, out)
      break
    case "RestElement":
      collectPatternNames(pattern.argument, out)
      break
    case "ArrayPattern":
      for (const element of pattern.elements) {
        if (element !== null) collectPatternNames(element, out)
      }
      break
    case "ObjectPattern":
      for (const prop of pattern.properties) {
        collectPatternNames(prop.type === "RestElement" ? prop.argument : prop.value, out)
      }
      break
  }
  return out
}

// Whether a function body (or a parameter default) reads `arguments`, looking through arrows but not nested
// functions, which own theirs. Memoized so the object is only built for calls that can observe it.
const argumentsUse = new WeakMap<Fn["body"], boolean>()
export const usesArguments = (fn: Fn): boolean => {
  const cached = argumentsUse.get(fn.body)
  if (cached !== undefined) return cached
  const found = [...fn.parameters, fn.body].some(function visit(node: AnyNode | null): boolean {
    if (node === null || typeof node !== "object") return false
    if (node.type === "Identifier") return node.name === "arguments"
    if (node.type === "FunctionDeclaration" || node.type === "FunctionExpression") return false
    return Object.values(node).some((child) =>
      Array.isArray(child) ? child.some((item) => visit(item)) : visit(child as AnyNode | null),
    )
  })
  argumentsUse.set(fn.body, found)
  return found
}

// Whether evaluating a node can create a function, which could capture a loop's per-iteration bindings.
const closures = new WeakMap<AnyNode, boolean>()
export const createsClosure = (node: AnyNode): boolean => {
  const cached = closures.get(node)
  if (cached !== undefined) return cached
  const found = (function visit(item: AnyNode | null): boolean {
    if (item === null || typeof item !== "object") return false
    if (
      item.type === "FunctionExpression" ||
      item.type === "ArrowFunctionExpression" ||
      item.type === "FunctionDeclaration"
    )
      return true
    return Object.values(item).some((child) =>
      Array.isArray(child) ? child.some((entry) => visit(entry)) : visit(child as AnyNode | null),
    )
  })(node)
  closures.set(node, found)
  return found
}

// `var` names declared anywhere in a function body except inside nested functions, which own theirs.
// Memoized per body: a function's var names never change, and hoisting runs on every call.
const varNames = new WeakMap<ReadonlyArray<Statement | ModuleDeclaration>, ReadonlyArray<string>>()
const collectVarNames = (
  node: Statement | ModuleDeclaration | null | undefined,
  out: Array<string> = [],
): Array<string> => {
  if (!node) return out
  switch (node.type) {
    case "VariableDeclaration":
      if (node.kind === "var") for (const declaration of node.declarations) collectPatternNames(declaration.id, out)
      break
    case "BlockStatement":
      for (const statement of node.body) collectVarNames(statement, out)
      break
    case "IfStatement":
      collectVarNames(node.consequent, out)
      collectVarNames(node.alternate, out)
      break
    case "ForStatement":
      if (node.init?.type === "VariableDeclaration") collectVarNames(node.init, out)
      collectVarNames(node.body, out)
      break
    case "ForInStatement":
    case "ForOfStatement":
      if (node.left.type === "VariableDeclaration") collectVarNames(node.left, out)
      collectVarNames(node.body, out)
      break
    case "WhileStatement":
    case "DoWhileStatement":
    case "LabeledStatement":
      collectVarNames(node.body, out)
      break
    case "SwitchStatement":
      for (const item of node.cases) for (const statement of item.consequent) collectVarNames(statement, out)
      break
    case "TryStatement":
      collectVarNames(node.block, out)
      collectVarNames(node.handler?.body, out)
      collectVarNames(node.finalizer, out)
      break
  }
  return out
}

export const loopDeclaration = (left: VariableDeclaration | Pattern, statement: "for...of" | "for...in") => {
  if (left.type !== "VariableDeclaration") return undefined
  const declaration = left.declarations.length === 1 ? left.declarations[0] : undefined
  if (declaration === undefined) {
    throw typeError(`${statement} supports one declared binding.`, left)
  }
  const kind = left.kind
  return {
    pattern: declaration.id,
    mutable: kind !== "const",
    lexical: kind !== "var",
  }
}

export type CustomIterator = {
  iterator: Obj
  next: Value
  asynchronous: boolean
}

/** A resolved member: the object to read through and the receiver that inherited accessors see. */
export type MemberReference = {
  target: Obj
  key: PropertyKey
  receiver: Value
}

// Parameter lists of plain names bind without evaluating anything, so a call needs no binding work.
const simpleParameters = new WeakMap<ReadonlyArray<Pattern>, boolean>()
export const isSimple = (parameters: ReadonlyArray<Pattern>): boolean => {
  const cached = simpleParameters.get(parameters)
  if (cached !== undefined) return cached
  const simple = parameters.every((parameter) => parameter.type === "Identifier")
  simpleParameters.set(parameters, simple)
  return simple
}

// A block that declares nothing lexically needs no scope of its own.
const blockScopes = new WeakMap<ReadonlyArray<Statement | ModuleDeclaration>, boolean>()
export const declaresLexically = (statements: ReadonlyArray<Statement | ModuleDeclaration>): boolean => {
  const cached = blockScopes.get(statements)
  if (cached !== undefined) return cached
  const declares = statements.some(
    (statement) =>
      statement.type === "FunctionDeclaration" ||
      (statement.type === "VariableDeclaration" && statement.kind !== "var"),
  )
  blockScopes.set(statements, declares)
  return declares
}

// A thenable the program's implicit async body adopts before copy-out.
export const isThenable = (value: Value): boolean =>
  value instanceof PromiseObj || (value instanceof Obj && typeofValue(get(value, "then")) === "function")

export const createFunction = (
  builtins: Builtins,
  scopes: ScopeStack,
  node: FunctionDeclaration | FunctionExpression | ArrowFunctionExpression,
  name = node.type === "ArrowFunctionExpression" ? "" : (node.id?.name ?? ""),
): Fn => {
  const fn = new Fn(
    builtins.Function,
    name,
    node.params,
    node.body,
    scopes.capture(),
    node.async,
    node.generator,
    node.type === "ArrowFunctionExpression",
  )
  // Each generator function gets its own prototype, so `g() instanceof g` holds as in JS.
  if (node.generator)
    define(fn, "prototype", new Obj(node.async ? builtins.AsyncGenerator : builtins.Generator), hidden)
  // The body of a named function expression sees its own name, read-only.
  if (node.type === "FunctionExpression" && node.id) {
    fn.capturedScopes.push(new Map([[node.id.name, { mutable: false, value: fn, initialized: true }]]))
  }
  return fn
}

/** NamedEvaluation: whether `node` is an anonymous function definition, which takes the name it is assigned to. */
export const isAnonymousFunction = (node: Expression): node is FunctionExpression | ArrowFunctionExpression =>
  node.type === "ArrowFunctionExpression" || (node.type === "FunctionExpression" && !node.id)

// Repeated `function` declarations and `var` clashes are legal: the last declaration wins.
export const hoistFunctions = (
  builtins: Builtins,
  scopes: ScopeStack,
  statements: ReadonlyArray<Statement | ModuleDeclaration>,
): void => {
  for (const node of statements) {
    if (node.type !== "FunctionDeclaration") continue
    scopes
      .current()
      .set(node.id.name, { mutable: true, value: createFunction(builtins, scopes, node), initialized: true })
  }
}

// Hoisted `var` bindings start undefined, or copy a same-named parameter. Function bodies hoist
// into their own scope above the parameters so closures in parameter defaults keep seeing outer names.
export const hoistVars = (
  scopes: ScopeStack,
  statements: ReadonlyArray<Statement | ModuleDeclaration>,
  parameters?: Map<string, Binding>,
): void => {
  const names =
    varNames.get(statements) ??
    statements.reduce<Array<string>>((out, statement) => collectVarNames(statement, out), [])
  varNames.set(statements, names)
  const scope = scopes.current()
  for (const name of names) {
    if (scope.has(name)) continue
    scope.set(name, { mutable: true, value: parameters?.get(name)?.value, initialized: true })
  }
}

export const predeclareLexical = (scopes: ScopeStack, statements: ReadonlyArray<Statement | ModuleDeclaration>) => {
  for (const statement of statements) {
    if (statement.type !== "VariableDeclaration") continue
    const kind = statement.kind
    if (kind === "var") continue
    for (const declaration of statement.declarations) {
      for (const name of collectPatternNames(declaration.id)) {
        scopes.reserve(name, kind !== "const", declaration)
      }
    }
  }
}

export const predeclarePattern = (scopes: ScopeStack, pattern: Pattern, mutable: boolean, node: AstNode): void => {
  for (const name of collectPatternNames(pattern)) scopes.reserve(name, mutable, node)
}

/** Binds one import declaration's names: imports load before any code runs, as in a module. */
export const bindImport = <R>(ctx: Interpreter<R>, scopes: ScopeStack, node: ImportDeclaration): void => {
  const specifier = String(node.source.value)
  if (node.specifiers.length === 0) ctx.module(specifier, node)
  for (const binding of node.specifiers) {
    scopes.declare(binding.local.name, imported(ctx, binding, specifier), false, binding)
  }
}

// A default import binds the module itself and a named import one of its properties, as Node imports CommonJS.
const imported = <R>(
  ctx: Interpreter<R>,
  binding: ImportDeclaration["specifiers"][number],
  specifier: string,
): Value => {
  if (binding.type === "ImportDefaultSpecifier") return ctx.module(specifier, binding)
  const namespace = ctx.namespace(specifier, binding)
  if (binding.type === "ImportNamespaceSpecifier") return namespace
  const name = binding.imported.type === "Identifier" ? binding.imported.name : String(binding.imported.value)
  if (!hasOwn(namespace, name)) throw syntaxError(`"${specifier}" has no export named "${name}".`, binding)
  return getOwn(namespace, name)
}

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
export const enumerableKeys = <R>(ctx: Interpreter<R>, value: Value, node: AstNode): Array<string> => {
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
export const readProperty = (target: Obj, key: PropertyKey, node: AstNode, receiver: Value = target): Value => {
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

/** Template objects by site: a tag sees the same `strings` array every time its literal is evaluated, as in JS. */
export const templateObject = <R>(ctx: Interpreter<R>, node: TaggedTemplateExpression): Arr => {
  const cached = ctx.templates.get(node)
  if (cached !== undefined) return cached
  const array = ctx.builtins.Array
  // An invalid escape such as `\unicode` cooks to `undefined` and survives only in `raw`.
  const strings = new Arr(
    array,
    node.quasi.quasis.map((quasi) => quasi.value.cooked ?? undefined),
  )
  define(
    strings,
    "raw",
    new Arr(
      array,
      node.quasi.quasis.map((quasi) => quasi.value.raw),
    ),
    frozen,
  )
  ctx.templates.set(node, strings)
  return strings
}
