import type {
  AnyNode,
  ArrayExpression,
  ArrayPattern,
  AssignmentPattern,
  ArrowFunctionExpression,
  AssignmentExpression,
  AssignmentProperty,
  AwaitExpression,
  BinaryExpression,
  BlockStatement,
  BreakStatement,
  CallExpression,
  ChainExpression,
  ConditionalExpression,
  ContinueStatement,
  DoWhileStatement,
  Expression,
  ForInStatement,
  ForOfStatement,
  ForStatement,
  FunctionDeclaration,
  FunctionExpression,
  Identifier,
  IfStatement,
  LabeledStatement,
  LogicalExpression,
  MemberExpression,
  ModuleDeclaration,
  NewExpression,
  ObjectExpression,
  Pattern,
  Program,
  Property,
  ReturnStatement,
  SequenceExpression,
  SpreadElement,
  Statement,
  Super,
  SwitchStatement,
  TaggedTemplateExpression,
  Literal,
  TemplateLiteral,
  ThrowStatement,
  TryStatement,
  UnaryExpression,
  UpdateExpression,
  VariableDeclaration,
  WhileStatement,
  YieldExpression,
} from "acorn"
import type { Context } from "effect"
import { fromJson, type Json, toBoundary } from "../data.js"
import { ToolReference, type ToolRuntime } from "../tool-runtime.js"
import {
  type AstNode,
  AsyncIteratorSymbol,
  type Binding,
  GeneratorReturn,
  IteratorSymbol,
  OptionalShortCircuit,
  invalidData,
  Throw,
  rangeError,
  type StatementResult,
  typeError,
  unsupportedSyntax,
} from "./model.js"
import { checkStringLength } from "./limits.js"
import { locate, materialize } from "./errors.js"
import { type Builtins, primitivePrototype } from "./intrinsics.js"
import { globals } from "./globals.js"
import {
  assign,
  Callable,
  define,
  frozen,
  get,
  hostCursor,
  IteratorObj,
  type Cursor,
  has,
  hidden,
  hasPrototype,
  keys,
  Native,
  parseArrayIndex,
  Arguments,
  Arr,
  Fn,
  GeneratorObj,
  Obj,
  PromiseObj,
  iteratorResult,
  remove,
  set,
  coerceToNumber,
  coerceToString,
  type NativeResult,
  type Step,
  type Value,
} from "./objects.js"
import { type Hint, preserveConsumerError, toPrimitive } from "./callback.js"
import {
  AsyncBoundary,
  Await,
  Call,
  type Eval,
  type GeneratorRequest,
  Interruption,
  isEval,
  MAX_CALL_DEPTH,
  Runner,
  Slice,
  Task,
  Yield,
  normal,
} from "./runner.js"
import { describeValue, isOpaque, rejectCircularInsertion, typeofValue } from "./references.js"
import { fn } from "./native.js"
import { capability } from "./promises.js"
import { ScopeStack } from "./scope.js"
import { constructRegExp } from "../stdlib/regexp.js"
import { enumerableSource } from "../stdlib/object.js"
import { compoundOperators } from "../stdlib/value.js"
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
const propertyKey = (value: Value): PropertyKey =>
  typeof value === "string" || typeof value === "number" || typeof value === "symbol" ? value : coerceToString(value)

// What a loop does with its body's result: exit with a StatementResult, or undefined to keep iterating.
// Unlabelled break ends this loop; a label the loop does not carry propagates outward.
const loopExit = (result: StatementResult, labels: ReadonlySet<string> | undefined): StatementResult | undefined => {
  if (result.kind === "return") return result
  if (result.kind === "break") {
    if (result.label !== undefined && !labels?.has(result.label)) return result
    return { kind: "none" }
  }
  if (result.kind === "continue" && result.label !== undefined && !labels?.has(result.label)) return result
  return undefined
}

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

// OrdinaryHasInstance: walk the left operand's chain looking for the constructor's `prototype`.
// acorn types every literal as possibly a BigInt or RegExp; regex literals become RegExp objects before this is asked.
const literal = (node: Literal): Value => {
  if (typeof node.value === "bigint") throw typeError("BigInt literals are not supported.", node)
  if (node.value instanceof RegExp) throw unsupportedSyntax("RegExpLiteral", node)
  return node.value
}

const instanceofValue = (lhs: Value, rhs: Value, node: AstNode): boolean => {
  if (!(rhs instanceof Callable)) {
    throw typeError("The right-hand side of 'instanceof' is not callable.", node)
  }
  const prototype = get(rhs, "prototype")
  if (!(prototype instanceof Obj)) {
    throw typeError("The right-hand side of 'instanceof' has no 'prototype' object.", node)
  }
  return hasPrototype(lhs, prototype)
}

const collectPatternNames = (pattern: Pattern, out: Array<string> = []): Array<string> => {
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
const usesArguments = (fn: Fn): boolean => {
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
const createsClosure = (node: AnyNode): boolean => {
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

const loopDeclaration = (left: VariableDeclaration | Pattern, statement: "for...of" | "for...in") => {
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

type CustomIterator = {
  iterator: Obj
  next: Value
  asynchronous: boolean
}

/** A resolved member: the object to read through and the receiver that inherited accessors see. */
type MemberReference = {
  target: Obj
  key: PropertyKey
  receiver: Value
}

const none: StatementResult = { kind: "none" }

/** Marks an operand a fast path has not evaluated yet, since `undefined` is a value. */
const unevaluated: unique symbol = Symbol("codemode.unevaluated")

type Reference = MemberReference | ToolReference | { value: Value } | typeof OptionalShortCircuit

// Parameter lists of plain names bind without evaluating anything, so a call needs no binding work.
const simpleParameters = new WeakMap<ReadonlyArray<Pattern>, boolean>()
const isSimple = (parameters: ReadonlyArray<Pattern>): boolean => {
  const cached = simpleParameters.get(parameters)
  if (cached !== undefined) return cached
  const simple = parameters.every((parameter) => parameter.type === "Identifier")
  simpleParameters.set(parameters, simple)
  return simple
}

// A block that declares nothing lexically needs no scope of its own.
const blockScopes = new WeakMap<ReadonlyArray<Statement | ModuleDeclaration>, boolean>()
const declaresLexically = (statements: ReadonlyArray<Statement | ModuleDeclaration>): boolean => {
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

const isAbrupt = (result: StatementResult): boolean =>
  result.kind === "return" || result.kind === "break" || result.kind === "continue"

// A thenable the program's implicit async body adopts before copy-out.
const isThenable = (value: Value): boolean =>
  value instanceof PromiseObj || (value instanceof Obj && typeofValue(get(value, "then")) === "function")

/** One program execution: the tool bridge, job queue, captured logs, and the global scope built once. */
export class Interpreter<R> {
  readonly tools: ToolRuntime<R>
  readonly runner: Runner<R>
  readonly builtins: Builtins
  readonly logs: Array<string>
  /** Template objects by site: a tag sees the same `strings` array every time its literal is evaluated, as in JS. */
  readonly templates = new WeakMap<TaggedTemplateExpression, Arr>()
  private readonly root: Frame<R>

  constructor(options: {
    readonly tools: ToolRuntime<R>
    /** The caller's services, which host work runs with. */
    readonly services: Context.Context<R>
    readonly builtins: Builtins
    readonly logs?: Array<string>
    readonly globals?: (ctx: Interpreter<R>) => ReadonlyArray<readonly [string, Value]>
  }) {
    this.tools = options.tools
    this.builtins = options.builtins
    this.logs = options.logs ?? []
    this.runner = new Runner(this, options.services)
    // Program code has no receiver: top-level `this` is undefined, as in a module.
    const globalScope = new Map<string, Binding>([["this", { mutable: false, value: undefined }]])
    // Calling back into the program never reads frame state, so any frame serves; the root is always alive.
    this.root = new Frame(this, new ScopeStack([globalScope]))
    for (const [name, value] of [...globals(this), ...(options.globals?.(this) ?? [])]) {
      globalScope.set(name, { mutable: false, value })
    }
  }

  /** The program's body, as the first job: its completion value, copied out for the host. */
  *main(program: Program): Eval<Json | undefined> {
    return yield* toBoundary(this, yield* this.root.run(program))
  }

  /** Calls into the program; a built-in passes its own call site so failures inside are located there. */
  call(callable: Value, thisValue: Value, args: Array<Value>, site?: AstNode): Eval<Value> {
    return this.root.call(callable, thisValue, args, site)
  }

  /** Await: suspends the innermost async body until `value` settles. */
  *awaitValue(value: Value, node?: AstNode): Eval<Value> {
    return (yield new Await(value, node)) as Value
  }

  iterate(value: Value) {
    return this.root.iterate(value)
  }

  iterateDirect(value: Value) {
    return this.root.iterateDirect(value)
  }

  /** Runs one host call to completion before any other job: arguments cross as JSON, the result comes back as values. */
  *tool(run: ToolRuntime<R>["search"], args: Array<Value>) {
    const json: Array<Json | undefined> = []
    for (const arg of args) json.push(yield* toBoundary(this, arg))
    return fromJson(this, (yield this.runner.blocking(run(json))) as Json | undefined)
  }
}

/** One activation: the top-level program or a single function call, evaluating against its own scope chain. */
class Frame<R> {
  /** The body of a generator function, where `yield` suspends. */
  private generator = false
  private generatorAsync = false

  constructor(
    private readonly ctx: Interpreter<R>,
    private scopes: ScopeStack,
  ) {}

  *run(program: Program): Eval<Value> {
    // Keep top-level declarations separate so they can shadow builtins.
    this.scopes.push()
    try {
      this.predeclareLexical(program.body)
      this.hoistFunctions(program.body)
      this.hoistVars(program.body)
      let value: Value = undefined
      for (const [index, statement] of program.body.entries()) {
        if (index === program.body.length - 1 && statement.type === "ExpressionStatement") {
          value = yield* this.evaluateExpression(statement.expression)
          break
        }
        const result = yield* this.evaluateStatement(statement)

        if (result.kind === "return") {
          value = result.value
          break
        }

        if (result.kind === "break" || result.kind === "continue") {
          throw typeError(`Unexpected '${result.kind}' outside of a loop.`, statement)
        }
      }

      // The implicit async body adopts returned promises before copy-out.
      return isThenable(value) ? yield* this.awaitValue(value) : value
    } finally {
      this.scopes.pop()
    }
  }

  // The call returns its promise at once. Arguments cross on the caller's stack, since `toJSON` is program code, and a
  // promise argument is awaited first; the host call starts once they have crossed, so admission and hooks happen at
  // the call site, and runs concurrently with the program.
  private *createToolCallPromise(
    path: ReadonlyArray<string>,
    args: Array<Value>,
    site: AstNode | undefined,
  ): Eval<Value> {
    const ctx = this.ctx
    const runner = ctx.runner
    const promise = runner.newPromise()
    const resolving = runner.resolving(promise)
    const body = function* (): Eval<void> {
      const json: Array<Json | undefined> = []
      for (const arg of args) json.push(yield* toBoundary(ctx, arg))
      runner.host(
        ctx.tools.execute(path, json),
        (settled) =>
          settled.ok
            ? resolving.resolve(fromJson(ctx, settled.value as Json | undefined))
            : resolving.reject(settled.error),
        site,
      )
    }
    return (yield new Call(
      body(),
      new AsyncBoundary((completion) => {
        if (!completion.ok) resolving.reject(completion.error)
      }, promise),
    )) as Value
  }

  awaitValue(value: Value, node?: AstNode): Eval<Value> {
    return this.ctx.awaitValue(value, node)
  }

  private *evaluateStatement(node: Statement | ModuleDeclaration): Eval<StatementResult> {
    const result = this.execute(node)
    return isEval(result) ? yield* result : result
  }

  // Like `evaluate`: statements that cannot run program code complete without a generator.
  private execute(node: Statement | ModuleDeclaration): StatementResult | Eval<StatementResult> {
    switch (node.type) {
      case "ExpressionStatement": {
        const result = this.evaluate(node.expression)
        return isEval(result) ? this.finishExpressionStatement(result) : none
      }
      case "VariableDeclaration":
        return this.evaluateVariableStatement(node)
      case "ReturnStatement":
        return this.evaluateReturnStatement(node)
      case "BlockStatement":
        return this.evaluateBlock(node)
      case "IfStatement":
        return this.evaluateIfStatement(node)
      case "SwitchStatement":
        return this.evaluateSwitchStatement(node)
      case "LabeledStatement":
        return this.evaluateLabeledStatement(node)
      case "WhileStatement":
        return this.evaluateWhileStatement(node)
      case "DoWhileStatement":
        return this.evaluateDoWhileStatement(node)
      case "ForStatement":
        return this.evaluateForStatement(node)
      case "ForOfStatement":
        return this.evaluateForOfStatement(node)
      case "ForInStatement":
        return this.evaluateForInStatement(node)
      case "BreakStatement":
        return this.evaluateBreakStatement(node)
      case "ContinueStatement":
        return this.evaluateContinueStatement(node)
      case "ThrowStatement":
        return this.evaluateThrowStatement(node)
      case "TryStatement":
        return this.evaluateTryStatement(node)
      case "EmptyStatement":
        return none
      case "FunctionDeclaration":
        return none
      default:
        throw unsupportedSyntax(node.type, node)
    }
  }

  private *finishExpressionStatement(work: Eval<Value>): Eval<StatementResult> {
    yield* work
    return none
  }

  private *evaluateVariableStatement(node: VariableDeclaration): Eval<StatementResult> {
    yield* this.evaluateVariableDeclaration(node)
    return none
  }

  private *evaluateReturnStatement(node: ReturnStatement): Eval<StatementResult> {
    const argumentNode = node.argument
    if (!argumentNode) return { kind: "return", value: undefined }
    const evaluated = this.evaluate(argumentNode)
    const value = isEval(evaluated) ? yield* evaluated : evaluated
    // An async generator awaits what it returns, as it awaits what it yields.
    return { kind: "return", value: this.generatorAsync ? yield* this.awaitValue(value, node) : value }
  }

  private *evaluateBlock(node: BlockStatement): Eval<StatementResult> {
    const body = node.body
    const scoped = declaresLexically(body)
    if (scoped) {
      this.scopes.push()
      this.predeclareLexical(body)
      this.hoistFunctions(body)
    }
    try {
      for (const statement of body) {
        const executed = this.execute(statement)
        const result = isEval(executed) ? yield* executed : executed
        if (result.kind !== "none") return result
      }

      return none
    } finally {
      if (scoped) this.scopes.pop()
    }
  }

  private createFunction(
    node: FunctionDeclaration | FunctionExpression | ArrowFunctionExpression,
    name = node.type === "ArrowFunctionExpression" ? "" : (node.id?.name ?? ""),
  ): Fn {
    const builtins = this.ctx.builtins
    const fn = new Fn(
      builtins.Function,
      name,
      node.params,
      node.body,
      this.scopes.capture(),
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

  // NamedEvaluation: an anonymous function definition takes the name of what it is assigned to.
  private *evaluateNamed(node: Expression, name: string): Eval<Value> {
    if (node.type === "ArrowFunctionExpression" || (node.type === "FunctionExpression" && !node.id)) {
      return this.createFunction(node, name)
    }
    return yield* this.evaluateExpression(node)
  }

  // Repeated `function` declarations and `var` clashes are legal: the last declaration wins.
  private hoistFunctions(statements: ReadonlyArray<Statement | ModuleDeclaration>): void {
    for (const node of statements) {
      if (node.type !== "FunctionDeclaration") continue
      this.scopes.current().set(node.id.name, { mutable: true, value: this.createFunction(node), initialized: true })
    }
  }

  // Hoisted `var` bindings start undefined, or copy a same-named parameter. Function bodies hoist
  // into their own scope above the parameters so closures in parameter defaults keep seeing outer names.
  private hoistVars(statements: ReadonlyArray<Statement | ModuleDeclaration>, parameters?: Map<string, Binding>): void {
    const names =
      varNames.get(statements) ??
      statements.reduce<Array<string>>((out, statement) => collectVarNames(statement, out), [])
    varNames.set(statements, names)
    const scope = this.scopes.current()
    for (const name of names) {
      if (scope.has(name)) continue
      scope.set(name, { mutable: true, value: parameters?.get(name)?.value, initialized: true })
    }
  }

  private predeclareLexical(statements: ReadonlyArray<Statement | ModuleDeclaration>): void {
    for (const statement of statements) {
      if (statement.type !== "VariableDeclaration") continue
      const kind = statement.kind
      if (kind === "var") continue
      for (const declaration of statement.declarations) {
        for (const name of collectPatternNames(declaration.id)) {
          this.scopes.reserve(name, kind !== "const", declaration)
        }
      }
    }
  }

  private predeclarePattern(pattern: Pattern, mutable: boolean, node: AstNode): void {
    for (const name of collectPatternNames(pattern)) this.scopes.reserve(name, mutable, node)
  }

  private *evaluateIfStatement(node: IfStatement): Eval<StatementResult> {
    const test = this.evaluate(node.test)
    const branch = (isEval(test) ? yield* test : test) ? node.consequent : node.alternate
    if (!branch) return none
    const result = this.execute(branch)
    return isEval(result) ? yield* result : result
  }

  private *evaluateSwitchStatement(node: SwitchStatement): Eval<StatementResult> {
    const discriminant = yield* this.evaluateExpression(node.discriminant)
    this.scopes.push()
    try {
      const cases = node.cases
      const statements = cases.flatMap((branch) => branch.consequent)
      this.predeclareLexical(statements)
      this.hoistFunctions(statements)
      let defaultIndex: number | undefined
      let selected: number | undefined
      for (const [index, branch] of cases.entries()) {
        const test = branch.test
        if (!test) {
          defaultIndex = index
          continue
        }
        if ((yield* this.evaluateExpression(test)) === discriminant) {
          selected = index
          break
        }
      }
      const start = selected ?? defaultIndex
      if (start === undefined) return none
      for (let index = start; index < cases.length; index += 1) {
        for (const statement of cases[index]!.consequent) {
          const result = yield* this.evaluateStatement(statement)
          if (result.kind === "break") {
            if (result.label === undefined) return none
            return result
          }
          if (result.kind === "return" || result.kind === "continue") return result
        }
      }
      return none
    } finally {
      this.scopes.pop()
    }
  }

  private *evaluateWhileStatement(node: WhileStatement, labels?: ReadonlySet<string>): Eval<StatementResult> {
    const runner = this.ctx.runner
    while (true) {
      const test = this.evaluate(node.test)
      if (!(isEval(test) ? yield* test : test)) break
      const executed = this.execute(node.body)
      const exit = loopExit(isEval(executed) ? yield* executed : executed, labels)
      if (exit !== undefined) return exit
      if (runner.tick()) yield Slice
    }

    return none
  }

  private *evaluateDoWhileStatement(node: DoWhileStatement, labels?: ReadonlySet<string>): Eval<StatementResult> {
    const runner = this.ctx.runner
    do {
      const exit = loopExit(yield* this.evaluateStatement(node.body), labels)
      if (exit !== undefined) return exit
      if (runner.tick()) yield Slice
    } while (yield* this.evaluateExpression(node.test))

    return none
  }

  private *evaluateForStatement(node: ForStatement, labels?: ReadonlySet<string>): Eval<StatementResult> {
    const runner = this.ctx.runner
    this.scopes.push()
    try {
      const initNode = node.init
      const testNode = node.test
      const updateNode = node.update

      if (initNode?.type === "VariableDeclaration" && initNode.kind !== "var") {
        this.predeclareLexical([initNode])
      }

      if (initNode) {
        if (initNode.type === "VariableDeclaration") {
          yield* this.evaluateVariableDeclaration(initNode)
        } else {
          yield* this.evaluateExpression(initNode)
        }
      }

      // Each iteration gets fresh copies of the loop's `let` bindings, but only closures can tell them apart.
      const perIterationBindings =
        initNode?.type === "VariableDeclaration" &&
        initNode.kind !== "var" &&
        [node.init, node.test, node.update, node.body].some((part) => part && createsClosure(part))
          ? Array.from(this.scopes.current().keys())
          : []

      const nextIteration = () => {
        if (perIterationBindings.length === 0) return
        const current = this.scopes.current()
        this.scopes.pop()
        this.scopes.push(
          new Map(perIterationBindings.map((name): [string, Binding] => [name, { ...current.get(name)! }])),
        )
      }
      nextIteration()

      while (true) {
        if (testNode) {
          const test = this.evaluate(testNode)
          if (!(isEval(test) ? yield* test : test)) break
        }
        const executed = this.execute(node.body)
        const exit = loopExit(isEval(executed) ? yield* executed : executed, labels)
        if (exit !== undefined) return exit

        nextIteration()
        if (updateNode) {
          const update = this.evaluate(updateNode)
          if (isEval(update)) yield* update
        }
        if (runner.tick()) yield Slice
      }

      return none
    } finally {
      this.scopes.pop()
    }
  }

  private *evaluateForOfStatement(node: ForOfStatement, labels?: ReadonlySet<string>): Eval<StatementResult> {
    const runner = this.ctx.runner
    const awaiting = node.await
    const left = node.left
    const declared = loopDeclaration(left, "for...of")
    if (declared?.lexical) this.scopes.push()

    try {
      if (declared?.lexical) this.predeclarePattern(declared.pattern, declared.mutable, left)
      const right = yield* this.evaluateExpression(node.right)

      const builtin = this.builtinCursor(right)
      const custom = builtin === undefined ? yield* this.customIterator(right, node, awaiting) : undefined
      if (custom === undefined && builtin === undefined) {
        throw invalidData(
          `${awaiting ? "for await...of" : "for...of"} requires an iterable value, received ${describeValue(right)}.`,
          node,
        )
      }
      // `for await` over a synchronous iterator drives it through CreateAsyncFromSyncIterator, as JS does.
      const iterator = awaiting && !custom?.asynchronous ? this.asyncFromSync(builtin, custom, node) : custom
      const cursor = iterator === undefined ? builtin : undefined
      const self = this
      const close = function* (): Eval<void> {
        if (iterator) return yield* self.closeIterator(iterator, node)
        yield* cursor!.close()
      }

      if (left.type === "RestElement" || left.type === "AssignmentPattern") {
        throw typeError("Unsupported for...of binding.", left)
      }
      const assignment = left.type === "VariableDeclaration" ? undefined : left
      // Each iteration gets a fresh binding, but only a closure in the body can tell; without one, a single
      // `for (const x of ...)` binding is reused.
      const reused =
        declared?.lexical && declared.pattern.type === "Identifier" && !createsClosure(node.body)
          ? { mutable: declared.mutable, value: undefined as Value, initialized: false }
          : undefined
      if (reused !== undefined) this.scopes.push(new Map([[(declared!.pattern as Identifier).name, reused]]))

      try {
        while (true) {
          const step: Step = iterator ? yield* this.nextIteratorResult(iterator, node) : yield* cursor!.next()
          if (step.done) return none
          let result: StatementResult
          try {
            if (reused !== undefined) {
              reused.value = step.value
              reused.initialized = true
              const executed = this.execute(node.body)
              result = isEval(executed) ? yield* executed : executed
            } else if (declared?.lexical) {
              this.scopes.push()
              try {
                this.predeclarePattern(declared.pattern, declared.mutable, left)
                yield* this.declarePattern(declared.pattern, step.value, declared.mutable, left, true)
                result = yield* this.evaluateStatement(node.body)
              } finally {
                this.scopes.pop()
              }
            } else {
              if (declared) yield* this.assignPattern(declared.pattern, step.value, left)
              else if (assignment) yield* this.assignPattern(assignment, step.value, left)
              result = yield* this.evaluateStatement(node.body)
            }
          } catch (error) {
            return yield* preserveConsumerError(close, thrower(error))
          }
          const exit = loopExit(result, labels)
          if (exit !== undefined) {
            yield* close()
            return exit
          }
          if (runner.tick()) yield Slice
        }
      } finally {
        if (reused !== undefined) this.scopes.pop()
      }
    } finally {
      if (declared?.lexical) this.scopes.pop()
    }
  }

  // CreateAsyncFromSyncIterator: an async iterator over a synchronous one. Each `next()` promise settles a job after
  // the value does, and a rejected value closes the synchronous iterator first; `return()` calls the synchronous
  // iterator's own `return`, or settles at once when it has none.
  private asyncFromSync(
    builtin: Cursor | undefined,
    custom: CustomIterator | undefined,
    node: AstNode | undefined,
  ): CustomIterator {
    const ctx = this.ctx
    const runner = ctx.runner
    const builtins = ctx.builtins
    const result = (value: Value, done: boolean) => iteratorResult(builtins.Object, value, done)
    const self = this
    // IteratorNext passes the value `next` received, when it received one.
    const syncNext = function* (args: Array<Value>): Eval<Step> {
      if (!custom) return yield* builtin!.next()
      const object = self.requireIteratorObject(
        yield* self.call(custom.next, custom.iterator, args, node),
        "Iterator next() result",
        node,
      )
      return { done: Boolean(get(object, "done")), value: get(object, "value") }
    }
    // The synchronous iterator's `return`, looked up when it is needed; built-in collection iterators have none.
    const syncReturn = (): Value => (custom ? get(custom.iterator, "return") : undefined)
    const settle = (step: Step, closeOnRejection: boolean, made: ReturnType<typeof capability>) => {
      const rejected = (reason: unknown) => {
        if (step.done || !closeOnRejection || reason instanceof Interruption) return made.reject(reason)
        const body = function* (): Eval<void> {
          try {
            if (custom) yield* self.closeIterator(custom, node)
            else yield* builtin!.close()
          } catch {
            // The rejection wins over a failing close.
          }
          made.reject(reason)
        }
        return { task: new Task([{ body: body(), boundary: undefined }]), input: normal(undefined) }
      }
      let wrapper: PromiseObj
      try {
        wrapper = runner.promiseResolve(step.value)
      } catch (error) {
        const start = rejected(error)
        if (start !== undefined) runner.enqueue(() => start)
        return
      }
      runner.then(wrapper, (settled) =>
        settled.ok ? made.resolve(result(settled.value as Value, step.done)) : rejected(settled.error),
      )
    }
    const next = fn(builtins, "next", 1, function* (_, args) {
      const made = capability(ctx, node)
      try {
        settle(yield* syncNext(args), true, made)
      } catch (error) {
        made.reject(error)
      }
      return made.promise
    })
    const close = fn(builtins, "return", 1, function* (_, args) {
      const made = capability(ctx, node)
      try {
        const method = syncReturn()
        if (method === undefined || method === null) {
          if (builtin !== undefined) yield* builtin.close()
          made.resolve(result(args[0], true))
          return made.promise
        }
        const returned = self.requireIteratorObject(
          yield* self.call(self.requireIteratorMethod(method, "Iterator return", node), custom!.iterator, args, node),
          "Iterator return() result",
          node,
        )
        settle({ done: Boolean(get(returned, "done")), value: get(returned, "value") }, false, made)
      } catch (error) {
        made.reject(error)
      }
      return made.promise
    })
    const raise = fn(builtins, "throw", 1, function* (_, args) {
      const made = capability(ctx, node)
      try {
        const method = custom ? get(custom.iterator, "throw") : undefined
        if (method === undefined || method === null) {
          if (custom) yield* self.closeIterator(custom, node)
          else yield* builtin!.close()
          made.reject(typeError("The delegated iterator does not provide a throw() method.", node))
          return made.promise
        }
        const thrown = self.requireIteratorObject(
          yield* self.call(self.requireIteratorMethod(method, "Iterator throw", node), custom!.iterator, args, node),
          "Iterator throw() result",
          node,
        )
        settle({ done: Boolean(get(thrown, "done")), value: get(thrown, "value") }, true, made)
      } catch (error) {
        made.reject(error)
      }
      return made.promise
    })
    const adapter = new Obj(builtins.Object)
    define(adapter, "next", next, hidden)
    define(adapter, "return", close, hidden)
    define(adapter, "throw", raise, hidden)
    return { iterator: adapter, next, asynchronous: true }
  }

  *iterate(value: Value, node?: AstNode): Eval<Cursor | undefined> {
    const cursor = this.builtinCursor(value)
    if (cursor !== undefined) return cursor
    const iterator = yield* this.customIterator(value, node, false)
    return iterator === undefined ? undefined : this.customCursor(iterator, node)
  }

  /** GetIteratorDirect: drive an iterator by its own `next`, without asking for `[Symbol.iterator]`. */
  iterateDirect(value: Value, node?: AstNode): Cursor {
    if (value instanceof IteratorObj) return value.cursor
    if (!(value instanceof Obj)) {
      throw typeError(`An iterator must be an object, received ${describeValue(value)}.`, node)
    }
    return this.customCursor(
      {
        iterator: value,
        next: this.requireIteratorMethod(get(value, "next"), "Iterator next", node),
        asynchronous: false,
      },
      node,
    )
  }

  private customCursor(iterator: CustomIterator, node: AstNode | undefined): Cursor {
    return {
      next: () => this.nextIteratorResult(iterator, node),
      close: () => this.closeIterator(iterator, node),
    }
  }

  private builtinCursor(value: Value): Cursor | undefined {
    if (value instanceof IteratorObj) return value.cursor
    const iterator =
      typeof value === "string"
        ? value[Symbol.iterator]()
        : value instanceof Obj
          ? value.iterator(this.ctx.builtins)
          : undefined
    return iterator === undefined ? undefined : hostCursor(iterator)
  }

  private *customIterator(
    value: Value,
    node: AstNode | undefined,
    allowAsync = true,
  ): Eval<CustomIterator | undefined> {
    if (!(value instanceof Obj)) return undefined
    const asyncMethod = allowAsync ? get(value, AsyncIteratorSymbol) : undefined
    const method = asyncMethod ?? get(value, IteratorSymbol)
    if (method === undefined || method === null) return undefined
    const iterator = yield* this.call(this.requireIteratorMethod(method, "Iterator method", node), value, [], node)
    const object = this.requireIteratorObject(iterator, "Iterator method result", node)
    return {
      iterator: object,
      next: this.requireIteratorMethod(get(object, "next"), "Iterator next", node),
      asynchronous: asyncMethod !== undefined && asyncMethod !== null,
    }
  }

  private *nextIteratorResult(iterator: CustomIterator, node: AstNode | undefined): Eval<Step> {
    const called = yield* this.call(iterator.next, iterator.iterator, [], node)
    const object = this.requireIteratorObject(
      iterator.asynchronous ? yield* this.awaitValue(called, node) : called,
      "Iterator next() result",
      node,
    )
    return { done: Boolean(get(object, "done")), value: get(object, "value") }
  }

  private *closeIterator(iterator: CustomIterator, node: AstNode | undefined): Eval<void> {
    const close = get(iterator.iterator, "return")
    if (close === undefined || close === null) return
    const method = this.requireIteratorMethod(close, "Iterator return", node)
    const called = yield* this.call(method, iterator.iterator, [], node)
    this.requireIteratorObject(
      iterator.asynchronous ? yield* this.awaitValue(called, node) : called,
      "Iterator return() result",
      node,
    )
  }

  private requireIteratorObject(value: Value, context: string, node?: AstNode): Obj {
    if (value instanceof Obj) return value
    throw typeError(`${context} must be an object.`, node)
  }

  private requireIteratorMethod(value: Value, context: string, node?: AstNode): Value {
    if (typeofValue(value) === "function") return value
    throw typeError(`${context} must be a function.`, node)
  }

  // for...in over null/undefined iterates nothing, like JS.
  private enumerableKeys(value: Value, node: AstNode): Array<string> {
    if (value instanceof ToolReference) return [...this.ctx.tools.keys(value.path)]
    if (value === null || value === undefined) return []
    return keys(enumerableSource(this.ctx, "for...in", value, node))
  }

  private *evaluateForInStatement(node: ForInStatement, labels?: ReadonlySet<string>): Eval<StatementResult> {
    const runner = this.ctx.runner
    const left = node.left
    const declared = loopDeclaration(left, "for...in")
    if (declared?.lexical) this.scopes.push()

    try {
      if (declared?.lexical) this.predeclarePattern(declared.pattern, declared.mutable, left)
      const right = yield* this.evaluateExpression(node.right)

      const keys = this.enumerableKeys(right, node.right)

      if (left.type === "RestElement" || left.type === "AssignmentPattern") {
        throw typeError("Unsupported for...in binding.", left)
      }
      const assignment = left.type === "VariableDeclaration" ? undefined : left

      for (const key of keys) {
        let result: StatementResult
        if (declared?.lexical) {
          this.scopes.push()
          try {
            this.predeclarePattern(declared.pattern, declared.mutable, left)
            yield* this.declarePattern(declared.pattern, key, declared.mutable, left, true)
            result = yield* this.evaluateStatement(node.body)
          } finally {
            this.scopes.pop()
          }
        } else {
          if (declared) yield* this.assignPattern(declared.pattern, key, left)
          else if (assignment) yield* this.assignPattern(assignment, key, left)
          result = yield* this.evaluateStatement(node.body)
        }

        const exit = loopExit(result, labels)
        if (exit !== undefined) return exit
        if (runner.tick()) yield Slice
      }

      return none
    } finally {
      if (declared?.lexical) this.scopes.pop()
    }
  }

  private evaluateBreakStatement(node: BreakStatement): StatementResult {
    return node.label ? { kind: "break", label: node.label.name } : { kind: "break" }
  }

  private evaluateContinueStatement(node: ContinueStatement): StatementResult {
    return node.label ? { kind: "continue", label: node.label.name } : { kind: "continue" }
  }

  private *evaluateLabeledStatement(node: LabeledStatement): Eval<StatementResult> {
    const labels = new Set<string>()
    let body: Statement = node
    while (body.type === "LabeledStatement") {
      labels.add(body.label.name)
      body = body.body
    }

    const result =
      body.type === "WhileStatement"
        ? yield* this.evaluateWhileStatement(body, labels)
        : body.type === "DoWhileStatement"
          ? yield* this.evaluateDoWhileStatement(body, labels)
          : body.type === "ForStatement"
            ? yield* this.evaluateForStatement(body, labels)
            : body.type === "ForOfStatement"
              ? yield* this.evaluateForOfStatement(body, labels)
              : body.type === "ForInStatement"
                ? yield* this.evaluateForInStatement(body, labels)
                : yield* this.evaluateStatement(body)

    return result.kind === "break" && result.label !== undefined && labels.has(result.label) ? none : result
  }

  private *evaluateThrowStatement(node: ThrowStatement): Eval<StatementResult> {
    throw new Throw(yield* this.evaluateExpression(node.argument))
  }

  private *evaluateTryStatement(node: TryStatement): Eval<StatementResult> {
    const handler = node.handler
    const finalizer = node.finalizer
    let result: StatementResult = none
    let failure: { readonly error: unknown } | undefined

    try {
      result = yield* this.evaluateStatement(node.block)
    } catch (error) {
      if (error instanceof Interruption) throw error
      // A generator's return() unwinds through `finally` but is not an exception `catch` sees.
      if (error instanceof GeneratorReturn || !handler) {
        if (!finalizer) throw error
        failure = { error }
      } else {
        const caught = materialize(this.ctx, error)
        const parameter = handler.param
        this.scopes.push()
        try {
          if (parameter) yield* this.declarePattern(parameter, caught, true, handler)
          result = yield* this.evaluateStatement(handler.body)
        } catch (error) {
          if (!finalizer || error instanceof Interruption) throw error
          failure = { error }
        } finally {
          this.scopes.pop()
        }
      }
    }

    if (!finalizer) return result
    const final = yield* this.evaluateStatement(finalizer)
    if (isAbrupt(final)) return final
    if (failure) throw failure.error
    return result
  }

  private *evaluateVariableDeclaration(node: VariableDeclaration): Eval<void> {
    const kind = node.kind
    for (const declaration of node.declarations) {
      if (declaration.type !== "VariableDeclarator") {
        throw typeError("Unsupported variable declaration shape.", declaration)
      }

      const init = declaration.init
      // `var x` alone is a no-op: the binding was hoisted on function entry.
      const id = declaration.id
      if (kind === "var") {
        if (init) {
          const value =
            id.type === "Identifier" ? yield* this.evaluateNamed(init, id.name) : yield* this.evaluateExpression(init)
          yield* this.assignPattern(id, value, declaration)
        }
        continue
      }
      const value = !init
        ? undefined
        : id.type === "Identifier"
          ? yield* this.evaluateNamed(init, id.name)
          : yield* this.evaluateExpression(init)
      yield* this.declarePattern(declaration.id, value, kind !== "const", declaration, true)
    }
  }

  private *declarePattern(
    pattern: Pattern,
    value: Value,
    mutable: boolean,
    node: AstNode,
    initialize = false,
  ): Eval<void> {
    if (pattern.type === "Identifier") {
      const name = pattern.name
      if (initialize) this.scopes.initialize(name, value, node)
      else this.scopes.declare(name, value, mutable, node)
      return
    }

    if (pattern.type === "AssignmentPattern") {
      const resolved = value === undefined ? yield* this.evaluateDefault(pattern) : value
      yield* this.declarePattern(pattern.left, resolved, mutable, node, initialize)
      return
    }

    if (pattern.type === "ObjectPattern") {
      if (value === null || value === undefined) {
        throw typeError(`Cannot destructure ${describeValue(value)} as it is ${value}.`, pattern)
      }

      const consumed = new Set<PropertyKey>()
      for (const property of pattern.properties) {
        if (property.type === "RestElement") {
          const rest = new Obj(this.ctx.builtins.Object)
          assign(rest, enumerableSource(this.ctx, "Object destructuring", value, pattern), consumed)
          yield* this.declarePattern(property.argument, rest, mutable, property, initialize)
          continue
        }

        const key = yield* this.destructuringPropertyKey(property)
        consumed.add(typeof key === "symbol" ? key : String(key))
        yield* this.declarePattern(
          property.value,
          this.destructuredProperty(value, key, property),
          mutable,
          property,
          initialize,
        )
      }
      return
    }

    if (pattern.type === "ArrayPattern") {
      return yield* this.destructureArrayPattern(pattern, value, (target, item, context) =>
        this.declarePattern(target, item, mutable, context, initialize),
      )
    }

    throw typeError(`Unsupported binding pattern '${pattern.type}'.`, pattern)
  }

  private *assignPattern(pattern: Pattern, value: Value, node: AstNode): Eval<void> {
    if (pattern.type === "Identifier") {
      this.scopes.set(pattern.name, value, pattern)
      return
    }

    if (pattern.type === "MemberExpression") {
      yield* this.writeMember(pattern, value)
      return
    }

    if (pattern.type === "AssignmentPattern") {
      const resolved = value === undefined ? yield* this.evaluateDefault(pattern) : value
      yield* this.assignPattern(pattern.left, resolved, node)
      return
    }

    if (pattern.type === "ObjectPattern") {
      if (value === null || value === undefined) {
        throw typeError(`Cannot destructure ${describeValue(value)} as it is ${value}.`, pattern)
      }

      const consumed = new Set<PropertyKey>()
      for (const property of pattern.properties) {
        if (property.type === "RestElement") {
          const rest = new Obj(this.ctx.builtins.Object)
          assign(rest, enumerableSource(this.ctx, "Object destructuring", value, pattern), consumed)
          yield* this.assignPattern(property.argument, rest, property)
          continue
        }
        const key = yield* this.destructuringPropertyKey(property)
        consumed.add(typeof key === "symbol" ? key : String(key))
        yield* this.assignPattern(property.value, this.destructuredProperty(value, key, property), property)
      }
      return
    }

    if (pattern.type === "ArrayPattern") {
      return yield* this.destructureArrayPattern(pattern, value, (target, item, context) =>
        this.assignPattern(target, item, context),
      )
    }

    throw typeError(`Unsupported assignment pattern '${pattern.type}'.`, node)
  }

  private evaluateDefault(pattern: AssignmentPattern): Eval<Value> {
    return pattern.left.type === "Identifier"
      ? this.evaluateNamed(pattern.right, pattern.left.name)
      : this.evaluateExpression(pattern.right)
  }

  private *destructureArrayPattern(
    pattern: ArrayPattern,
    value: Value,
    consume: (target: Pattern, value: Value, context: AstNode) => Eval<void>,
  ): Eval<void> {
    const cursor = yield* this.iterate(value, pattern)
    if (cursor === undefined) {
      throw typeError("Array destructuring requires a supported iterable value.", pattern)
    }
    let done = false
    for (const element of pattern.elements) {
      if (done) {
        if (element === null) continue
        yield* consume(
          element.type === "RestElement" ? element.argument : element,
          element.type === "RestElement" ? new Arr(this.ctx.builtins.Array) : undefined,
          element,
        )
        if (element.type === "RestElement") return
        continue
      }
      const step = yield* cursor.next()
      done = step.done
      if (element === null) continue
      if (element.type === "RestElement") {
        const rest: Array<Value> = []
        if (!step.done) rest.push(step.value)
        while (!done) {
          const next = yield* cursor.next()
          done = next.done
          if (!done) rest.push(next.value)
        }
        yield* consume(element.argument, new Arr(this.ctx.builtins.Array, rest), element)
        return
      }
      const consumed = consume(element, step.done ? undefined : step.value, pattern)
      yield* step.done ? consumed : preserveConsumerError(cursor.close, consumed)
    }
    if (!done) yield* cursor.close()
  }

  private *destructuringPropertyKey(property: Property | AssignmentProperty): Eval<PropertyKey> {
    if (property.type !== "Property" || property.kind !== "init") {
      throw typeError("Unsupported object destructuring property.", property)
    }
    const keyNode = property.key
    if (property.computed) return yield* this.toPropertyKey(yield* this.evaluateExpression(keyNode), keyNode)
    if (keyNode.type === "Identifier") return keyNode.name
    if (keyNode.type === "Literal") return String(keyNode.value)
    throw unsupportedSyntax(keyNode.type, keyNode)
  }

  private *evaluateExpression(node: Expression): Eval<Value> {
    const result = this.evaluate(node)
    return isEval(result) ? yield* result : result
  }

  // Evaluates leaves directly and returns the work for anything that may run program code, so the common cases cost
  // no generator; callers finish the work with `yield*`.
  private evaluate(node: Expression): Value | Eval<Value> {
    switch (node.type) {
      case "Literal": {
        const regex = node.regex
        if (regex) return constructRegExp(this.ctx.builtins, [regex.pattern, regex.flags])
        return literal(node)
      }
      case "Identifier":
        return this.scopes.get(node.name, node)
      case "ThisExpression":
        return this.scopes.get("this", node)
      case "BinaryExpression": {
        const operator = node.operator
        if (node.left.type === "PrivateIdentifier") throw unsupportedSyntax(node.left.type, node.left)
        const left = this.evaluate(node.left)
        if (isEval(left)) return this.evaluateBinaryExpression(node, left)
        const right = this.evaluate(node.right)
        if (isEval(right)) return this.evaluateBinaryExpression(node, left, right)
        if (operator === "instanceof") return instanceofValue(left, right, node)
        if (left instanceof Obj || right instanceof Obj) return this.applyOperator(operator, left, right, node)
        return this.applyBinaryOperator(operator, left, right, node)
      }
      case "LogicalExpression":
        return this.evaluateLogicalExpression(node)
      case "UnaryExpression":
        return this.evaluateUnaryExpression(node)
      case "AssignmentExpression": {
        const left = node.left
        if (left.type !== "Identifier") return this.evaluateAssignmentExpression(node)
        if (node.operator === "=") {
          const right =
            node.right.type === "ArrowFunctionExpression" ||
            (node.right.type === "FunctionExpression" && !node.right.id)
              ? this.createFunction(node.right, left.name)
              : this.evaluate(node.right)
          return isEval(right) ? this.assignAfter(left, right) : this.scopes.set(left.name, right, left)
        }
        if (!compoundOperators.has(node.operator)) return this.evaluateAssignmentExpression(node)
        const current = this.scopes.get(left.name, left)
        const right = this.evaluate(node.right)
        if (isEval(right) || current instanceof Obj || right instanceof Obj)
          return this.compoundAfter(node, current, right)
        return this.scopes.set(
          left.name,
          this.applyBinaryOperator(node.operator.slice(0, -1), current, right, node),
          left,
        )
      }
      case "SequenceExpression":
        return this.evaluateSequenceExpression(node)
      case "CallExpression":
        return this.evaluateCallExpression(node)
      case "ArrowFunctionExpression":
      case "FunctionExpression":
        return this.createFunction(node)
      case "MemberExpression": {
        const objectNode = node.object
        const propertyNode = node.property
        if (objectNode.type === "Super") throw unsupportedSyntax(objectNode.type, objectNode)
        if (propertyNode.type === "PrivateIdentifier") throw unsupportedSyntax(propertyNode.type, propertyNode)
        const object = this.evaluate(objectNode)
        if (isEval(object)) return this.readMember(node, object)
        if (object === OptionalShortCircuit) return OptionalShortCircuit
        if ((object === null || object === undefined) && node.optional) return OptionalShortCircuit
        const key =
          !node.computed && propertyNode.type === "Identifier" ? propertyNode.name : this.evaluate(propertyNode)
        if (isEval(key)) return this.readMember(node, object, key)
        const reference = this.memberReference(node, object, key)
        return isEval(reference) ? this.readMember(node, object, key) : this.readResolved(node, reference)
      }
      case "ChainExpression":
        return this.evaluateChainExpression(node)
      case "ObjectExpression":
        return this.evaluateObjectExpression(node)
      case "ArrayExpression":
        return this.evaluateArrayExpression(node)
      case "TemplateLiteral":
        return this.evaluateTemplateLiteral(node)
      case "TaggedTemplateExpression":
        return this.evaluateTaggedTemplate(node)
      case "ConditionalExpression":
        return this.evaluateConditionalExpression(node)
      case "UpdateExpression": {
        const argument = node.argument
        if (argument.type !== "Identifier") return this.evaluateUpdateExpression(node)
        const current = this.scopes.get(argument.name, argument)
        if (current instanceof Obj) return this.evaluateUpdateExpression(node)
        return this.update(node, argument, current)
      }
      case "AwaitExpression":
        return this.evaluateAwaitExpression(node)
      case "YieldExpression":
        return this.evaluateYieldExpression(node)
      case "NewExpression":
        return this.evaluateNewExpression(node)
      default:
        throw unsupportedSyntax(node.type, node)
    }
  }

  private *evaluateSequenceExpression(node: SequenceExpression): Eval<Value> {
    let result: Value
    for (const expression of node.expressions) {
      const value = this.evaluate(expression)
      result = isEval(value) ? yield* value : value
    }
    return result
  }

  private *evaluateChainExpression(node: ChainExpression): Eval<Value> {
    const value = yield* this.evaluateExpression(node.expression)
    return value === OptionalShortCircuit ? undefined : value
  }

  private *evaluateConditionalExpression(node: ConditionalExpression): Eval<Value> {
    const test = this.evaluate(node.test)
    const branch = this.evaluate((isEval(test) ? yield* test : test) ? node.consequent : node.alternate)
    return isEval(branch) ? yield* branch : branch
  }

  private *evaluateAwaitExpression(node: AwaitExpression): Eval<Value> {
    // Await always suspends, including for plain values.
    return yield* this.awaitValue(yield* this.evaluateExpression(node.argument), node)
  }

  private *evaluateNewExpression(node: NewExpression): Eval<Value> {
    const callee = yield* this.evaluateExpression(node.callee)
    const construct = callee instanceof Native ? callee.construct : undefined
    if (construct === undefined) {
      // `new` itself is supported, so a non-constructible callee is a TypeError like JS rather than
      // unsupported syntax. Built-ins like Number are real constructors in JS, so do not claim
      // otherwise; say `new` is unsupported for them and point at the plain call.
      const name = calleeDescription(node.callee) ?? "The called value"
      const message =
        callee instanceof Fn
          ? `${name} cannot be constructed: user-defined constructors and classes are not supported. Call it as a function that returns a plain object instead.`
          : callee instanceof Native
            ? `new ${name}(...) is not supported; call ${name}(...) without new instead.`
            : `${name} is not a constructor.`
      throw typeError(message, node)
    }
    const args = yield* this.evaluateCallArguments(node.arguments)
    const result = this.native(() => construct(args, callee as Native, node), node)
    return isEval(result) ? yield* result : result
  }

  // Finishes a binary expression whose left operand (and maybe right) `evaluate` already started.
  private *evaluateBinaryExpression(
    node: BinaryExpression,
    leftValue: Value | Eval<Value>,
    started: Value | Eval<Value> | typeof unevaluated = unevaluated,
  ): Eval<Value> {
    const operator = node.operator
    const lhs = isEval(leftValue) ? yield* leftValue : leftValue
    const rightValue = started === unevaluated ? this.evaluate(node.right) : started
    const rhs = isEval(rightValue) ? yield* rightValue : rightValue
    if (operator === "instanceof") return instanceofValue(lhs, rhs, node)
    if (lhs instanceof Obj || rhs instanceof Obj) return yield* this.applyOperator(operator, lhs, rhs, node)
    return this.applyBinaryOperator(operator, lhs, rhs, node)
  }

  /** ToPrimitive for an operand: data objects run their own methods; opaque values stay for the data gates below. */
  private *toPrimitive(value: Value, hint: Hint, node: AstNode): Eval<Value> {
    const result = this.native(() => toPrimitive(this.ctx, value, hint), node)
    return isEval(result) ? yield* result : result
  }

  // Arithmetic, relational, and bitwise operators convert both operands first, left then right, so a `valueOf`
  // runs (and throws) in spec order; `+` asks for the default hint and the rest for a number.
  private *applyOperator(operator: string, lhs: Value, rhs: Value, node: AstNode): Eval<Value> {
    if (!(lhs instanceof Obj || rhs instanceof Obj)) return this.applyBinaryOperator(operator, lhs, rhs, node)
    // IsLooselyEqual converts only an object facing a non-nullish primitive; two objects (including tool
    // references, which are not Obj) compare by identity.
    const equality = operator === "==" || operator === "!="
    // `in` checks the right operand before ToPropertyKey on the left, so a bad right side wins over a bad key.
    if (operator === "in" && lhs instanceof Obj && !isOpaque(lhs) && rhs instanceof Obj) {
      return has(rhs, yield* this.toPropertyKey(lhs, node))
    }
    const other = lhs instanceof Obj ? rhs : lhs
    const converts =
      primitiveOperators.has(operator) ||
      (equality && other !== null && other !== undefined && typeof other !== "object")
    if (!converts) return this.applyBinaryOperator(operator, lhs, rhs, node)
    const hint = operator === "+" || equality ? "default" : "number"
    const l = yield* this.toPrimitive(lhs, hint, node)
    const r = yield* this.toPrimitive(rhs, hint, node)
    return this.applyBinaryOperator(operator, l, r, node)
  }

  private applyBinaryOperator(operator: string, lhs: Value, rhs: Value, node: AstNode): Value {
    if (operator === "===") return lhs === rhs
    if (operator === "!==") return lhs !== rhs
    if (operator === "==") return this.looselyEqual(lhs, rhs, node)
    if (operator === "!=") return !this.looselyEqual(lhs, rhs, node)
    if (operator === "in" && rhs instanceof Obj && !isOpaque(lhs)) return has(rhs, propertyKey(lhs))
    if (isOpaque(lhs) || isOpaque(rhs)) {
      throw invalidData("Binary operators require data values.", node)
    }
    // Object operands were already converted by applyOperator; only primitives reach the arithmetic below.
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
  private looselyEqual(lhs: Value, rhs: Value, node: AstNode): boolean {
    const lhsObject = lhs !== null && typeof lhs === "object"
    const rhsObject = rhs !== null && typeof rhs === "object"
    if (lhsObject === rhsObject) return lhsObject ? lhs === rhs : lhs == rhs
    const primitive = lhsObject ? rhs : lhs
    if (primitive === null || primitive === undefined) return false
    // Data objects were converted by applyOperator, so only an opaque reference facing a primitive gets here.
    throw invalidData("Binary operators require data values.", node)
  }

  private *evaluateLogicalExpression(node: LogicalExpression): Eval<Value> {
    const operator = node.operator
    const leftValue = this.evaluate(node.left)
    const left = isEval(leftValue) ? yield* leftValue : leftValue
    if (operator === "&&") return left ? yield* this.evaluateExpression(node.right) : left
    if (operator === "||") return left ? left : yield* this.evaluateExpression(node.right)
    if (operator === "??")
      return left !== null && left !== undefined ? left : yield* this.evaluateExpression(node.right)
    throw typeError(`Unsupported logical operator '${operator}'.`, node)
  }

  private *evaluateUnaryExpression(node: UnaryExpression): Eval<Value> {
    const operator = node.operator
    const argument = node.argument
    if (operator === "delete") return yield* this.evaluateDeleteExpression(argument)
    // Undeclared names short-circuit, but declared TDZ bindings must still throw.
    if (operator === "typeof" && argument.type === "Identifier" && !this.scopes.resolve(argument.name)) {
      return "undefined"
    }
    const value = yield* this.evaluateExpression(argument)
    if (operator === "typeof") return typeofValue(value)
    if (operator === "!") return !value
    if (operator === "void") return undefined
    const operand = yield* this.toPrimitive(value, "number", node)
    if (isOpaque(operand)) {
      throw invalidData("Unary operators require data values.", node)
    }
    switch (operator) {
      case "+":
        return +(operand as number)
      case "-":
        return -(operand as number)
      case "~":
        return ~(operand as number)
      default:
        throw typeError(`Unsupported unary operator '${operator}'.`, node)
    }
  }

  private *evaluateAssignmentExpression(node: AssignmentExpression): Eval<Value> {
    const left = node.left
    const operator = node.operator
    // The binary operator a compound assignment applies: `+=` is `+`.
    const binary = operator.slice(0, -1)
    if (operator === "??=" || operator === "||=" || operator === "&&=") {
      return yield* this.evaluateLogicalAssignment(node, left, operator)
    }
    if (operator !== "=" && !compoundOperators.has(operator)) {
      throw typeError(`Unsupported assignment operator '${operator}'.`, node)
    }
    if (operator === "=" && (left.type === "ObjectPattern" || left.type === "ArrayPattern")) {
      const rightValue = yield* this.evaluateExpression(node.right)
      yield* this.assignPattern(left, rightValue, node)
      return rightValue
    }
    if (left.type === "Identifier") {
      const name = left.name
      if (operator !== "=") {
        const current = this.scopes.get(name, left)
        const evaluated = this.evaluate(node.right)
        const rightValue = isEval(evaluated) ? yield* evaluated : evaluated
        const next =
          current instanceof Obj || rightValue instanceof Obj
            ? yield* this.applyOperator(binary, current, rightValue, node)
            : this.applyBinaryOperator(binary, current, rightValue, node)
        return this.scopes.set(name, next, left)
      }
      const rightValue = yield* this.evaluateNamed(node.right, name)
      return this.scopes.set(name, rightValue, left)
    }
    if (left.type === "MemberExpression") {
      const self = this
      return yield* this.modifyMember(left, function* (current) {
        const rightValue = yield* self.evaluateExpression(node.right)
        if (operator === "=") return { write: true, next: rightValue, result: rightValue }
        const next = yield* self.applyOperator(binary, current, rightValue, node)
        return { write: true, next, result: next }
      })
    }
    throw typeError("Assignment target must be an Identifier or MemberExpression.", left)
  }

  private *assignAfter(left: Identifier, right: Eval<Value>): Eval<Value> {
    return this.scopes.set(left.name, yield* right, left)
  }

  private *compoundAfter(node: AssignmentExpression, current: Value, started: Value | Eval<Value>): Eval<Value> {
    const left = node.left as Identifier
    const binary = node.operator.slice(0, -1)
    const right = isEval(started) ? yield* started : started
    const next =
      current instanceof Obj || right instanceof Obj
        ? yield* this.applyOperator(binary, current, right, node)
        : this.applyBinaryOperator(binary, current, right, node)
    return this.scopes.set(left.name, next, left)
  }

  // `++`/`--` on a name whose value is already primitive.
  private update(node: UpdateExpression, argument: Identifier, current: Value): Value {
    if (isOpaque(current)) throw invalidData(`'${node.operator}' requires a data value.`, argument)
    const before = coerceToNumber(current)
    const next = node.operator === "++" ? before + 1 : before - 1
    this.scopes.set(argument.name, next, argument)
    return node.prefix ? next : before
  }

  private *evaluateLogicalAssignment(node: AssignmentExpression, left: Pattern, operator: string): Eval<Value> {
    const shouldAssign = (current: Value): boolean =>
      operator === "??=" ? current === null || current === undefined : operator === "||=" ? !current : Boolean(current)
    if (left.type === "Identifier") {
      const name = left.name
      const current = this.scopes.get(name, left)
      if (!shouldAssign(current)) return current
      const rightValue = yield* this.evaluateNamed(node.right, name)
      return this.scopes.set(name, rightValue, left)
    }
    if (left.type === "MemberExpression") {
      const self = this
      return yield* this.modifyMember(left, function* (current) {
        if (!shouldAssign(current)) return { write: false, next: current, result: current }
        const rightValue = yield* self.evaluateExpression(node.right)
        return { write: true, next: rightValue, result: rightValue }
      })
    }
    throw typeError("Assignment target must be an Identifier or MemberExpression.", left)
  }

  private *evaluateUpdateExpression(node: UpdateExpression): Eval<Value> {
    const operator = node.operator
    const argument = node.argument
    const prefix = node.prefix

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
      const name = argument.name
      const current = this.scopes.get(name, argument)
      const before = operand(current instanceof Obj ? yield* this.toPrimitive(current, "number", argument) : current)
      const next = before + increment
      this.scopes.set(name, next, argument)
      return prefix ? next : before
    }

    if (argument.type === "MemberExpression") {
      const self = this
      return yield* this.modifyMember(argument, function* (current) {
        const value = operand(yield* self.toPrimitive(current, "number", argument))
        const next = value + increment
        return { write: true, next, result: prefix ? next : value }
      })
    }

    throw typeError("Update target must be an Identifier or MemberExpression.", argument)
  }

  // EvaluateCall: a member callee supplies its base object as `this`; anything else calls with undefined.
  private *evaluateCallExpression(node: CallExpression): Eval<Value> {
    const callee = node.callee
    if (callee.type === "Super") throw unsupportedSyntax(callee.type, callee)
    const { callable, thisValue } =
      callee.type === "MemberExpression"
        ? yield* this.readMethod(callee)
        : { callable: yield* this.evaluateExpression(callee), thisValue: undefined }
    if (callable === OptionalShortCircuit) return OptionalShortCircuit
    if ((callable === null || callable === undefined) && node.optional) return OptionalShortCircuit

    const args = yield* this.evaluateCallArguments(node.arguments)
    const result = this.dispatch(callable, thisValue, args, node, callee)
    return isEval(result) ? yield* result : result instanceof Call ? ((yield result) as Value) : result
  }

  private *readMethod(node: MemberExpression): Eval<{ callable: Value; thisValue: Value }> {
    const reference = yield* this.getMemberReference(node)
    if (reference === OptionalShortCircuit) return { callable: OptionalShortCircuit, thisValue: undefined }
    if (reference instanceof ToolReference) return { callable: reference, thisValue: undefined }
    if ("value" in reference) return { callable: reference.value, thisValue: undefined }
    return { callable: this.readReference(reference, node), thisValue: reference.receiver }
  }

  *call(callable: Value, thisValue: Value, args: Array<Value>, node?: AstNode, callee?: Expression): Eval<Value> {
    const result = this.dispatch(callable, thisValue, args, node, callee)
    return isEval(result) ? yield* result : result instanceof Call ? ((yield result) as Value) : result
  }

  // The single dispatch for every invocation: call expressions and callbacks share it. A program function is a `Call`
  // for the caller to yield; a built-in that returns a value needs no generator.
  private dispatch(
    callable: Value,
    thisValue: Value,
    args: Array<Value>,
    node?: AstNode,
    callee?: Expression,
  ): Value | Eval<Value> | Call {
    if (callable instanceof Fn) return this.invokeFunction(callable, thisValue, args, node)
    if (callable instanceof Native) {
      // A loop made only of built-in calls has no program call or loop back-edge to count, so count the call.
      if (this.ctx.runner.tick()) return afterSlice(() => this.native(() => callable.call(thisValue, args, node), node))
      return this.native(() => callable.call(thisValue, args, node), node)
    }
    if (callable instanceof ToolReference) {
      if (callable.path.length === 0) {
        throw typeError("The tools root is not callable.", callee ?? node)
      }
      return this.createToolCallPromise(callable.path, args, node)
    }
    throw typeError(`${calleeDescription(callee) ?? "The called value"} is not a function.`, callee ?? node)
  }

  // Built-ins throw without a location, synchronously or inside their work; the call site supplies it.
  private native(body: () => NativeResult, node?: AstNode): Value | Eval<Value> {
    let result: NativeResult
    try {
      result = body()
    } catch (error) {
      throw locate(error, node)
    }
    return isEval(result) ? located(result, node) : result
  }

  private *evaluateCallArguments(argNodes: ReadonlyArray<Expression | SpreadElement>): Eval<Array<Value>> {
    const args: Array<Value> = []
    for (const argNode of argNodes) {
      if (argNode.type === "SpreadElement") {
        const spread = yield* this.evaluateExpression(argNode.argument)
        const cursor = yield* this.iterate(spread, argNode)
        if (cursor === undefined) throw typeError("Spread arguments require a synchronous iterable.", argNode)
        while (true) {
          const step = yield* cursor.next()
          if (step.done) break
          args.push(step.value)
        }
      } else {
        const value = this.evaluate(argNode)
        args.push(isEval(value) ? yield* value : value)
      }
    }
    return args
  }

  // A program call runs as its own activation on the explicit stack, so it is a `Call` for the caller to yield. An
  // async call returns its promise when the body first suspends or ends; a generator call binds its parameters and
  // returns the generator without running the body.
  invokeFunction(fn: Fn, thisValue: Value, args: Array<Value>, node?: AstNode): Call | Value | Eval<Value> {
    const runner = this.ctx.runner
    // The program's own activation is at the bottom of the stack.
    if (runner.depth > MAX_CALL_DEPTH) throw rangeError("Maximum call stack size exceeded", node)
    const invocation = new Frame(this.ctx, new ScopeStack([...fn.capturedScopes, new Map()]))
    const paramScope = invocation.scopes.current()
    // `this` and `arguments` are scope bindings so arrows resolve them lexically; a parameter named
    // `arguments` shadows the object, as in JS.
    if (!fn.arrow) paramScope.set("this", { mutable: false, value: thisValue, initialized: true })
    if (!fn.arrow && usesArguments(fn)) {
      paramScope.set("arguments", {
        mutable: true,
        value: new Arguments(this.ctx.builtins.Object, args),
        initialized: true,
      })
    }
    const simple = isSimple(fn.parameters)
    if (simple) {
      // A repeated name takes the last argument for it, as in JS.
      for (const [index, parameter] of fn.parameters.entries()) {
        paramScope.set((parameter as Identifier).name, { mutable: true, value: args[index], initialized: true })
      }
    } else {
      // Seed all parameters first so defaults cannot fall through to same-named outer bindings.
      for (const parameter of fn.parameters) {
        for (const name of collectPatternNames(parameter)) {
          paramScope.set(name, { mutable: true, value: undefined, initialized: false })
        }
      }
    }
    if (fn.generator) {
      invocation.generator = true
      invocation.generatorAsync = fn.async
      // The prototype is read after the parameters bind, since a default may replace it.
      const create = () => {
        const proto = get(fn, "prototype")
        return new GeneratorObj(
          proto instanceof Obj ? proto : fn.async ? this.ctx.builtins.AsyncGenerator : this.ctx.builtins.Generator,
          fn.async,
          generatorBody(invocation.functionBody(fn, paramScope)),
        )
      }
      if (simple) return create()
      return (function* () {
        yield* invocation.bindParameters(fn, args)
        return create()
      })()
    }
    const body = simple ? invocation.functionBody(fn, paramScope) : invocation.enter(fn, args, paramScope)
    if (!fn.async) return new Call(body)
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

  private *enter(fn: Fn, args: Array<Value>, paramScope: Map<string, Binding>): Eval<Value> {
    yield* this.bindParameters(fn, args)
    return yield* this.functionBody(fn, paramScope)
  }

  private *bindParameters(fn: Fn, args: Array<Value>): Eval<void> {
    const parameters = fn.parameters
    for (const [index, parameter] of parameters.entries()) {
      if (parameter.type === "RestElement") {
        yield* this.declarePattern(
          parameter.argument,
          new Arr(this.ctx.builtins.Array, args.slice(index)),
          true,
          parameter,
          true,
        )
        break
      }
      if (parameter.type === "Identifier") {
        // A sloppy simple parameter list may repeat a name; the last occurrence wins, as in JS.
        if (parameters.findLastIndex((other) => other.type === "Identifier" && other.name === parameter.name) !== index)
          continue
        this.scopes.initialize(parameter.name, args[index], parameter)
        continue
      }
      yield* this.declarePattern(parameter, args[index], true, parameter, true)
    }
  }

  private *functionBody(fn: Fn, paramScope: Map<string, Binding>): Eval<Value> {
    if (fn.body.type === "BlockStatement") {
      this.scopes.push()
      this.hoistVars(fn.body.body, paramScope)
      const result = yield* this.evaluateBlock(fn.body)
      return result.kind === "return" ? result.value : undefined
    }
    const result = this.evaluate(fn.body)
    return isEval(result) ? yield* result : result
  }

  private *evaluateYieldExpression(node: YieldExpression): Eval<Value> {
    const argument = node.argument
    if (!this.generator) throw typeError("yield is only valid inside a generator.", node)
    const value = argument ? yield* this.evaluateExpression(argument) : undefined
    if (node.delegate) return yield* this.delegateYield(value, node)
    return yield* this.suspendGenerator(this.generatorAsync ? yield* this.awaitValue(value, node) : value)
  }

  // Yield `value` and continue with the request that resumes the body: `next` supplies the value of the `yield`,
  // `throw` throws there, and `return` unwinds through `finally` blocks (an async generator awaits the value first).
  private *suspendGenerator(value: Value): Eval<Value> {
    const request = (yield new Yield(value)) as GeneratorRequest
    if (request.kind === "next") return request.value
    if (request.kind === "throw") throw new Throw(request.value)
    throw new GeneratorReturn(this.generatorAsync ? yield* this.awaitValue(request.value) : request.value)
  }

  private *delegateYield(value: Value, node: AstNode): Eval<Value> {
    const builtin = this.builtinCursor(value)
    if (builtin !== undefined && !this.generatorAsync) {
      while (true) {
        const step = yield* builtin.next()
        if (step.done) return undefined
        try {
          yield* this.suspendGenerator(step.value)
        } catch (error) {
          if (error instanceof GeneratorReturn) {
            yield* builtin.close()
            throw error
          }
          if (error instanceof Throw) {
            yield* builtin.close()
            throw typeError("The delegated iterator does not provide a throw() method.", node)
          }
          throw error
        }
      }
    }

    const custom = builtin === undefined ? yield* this.customIterator(value, node, this.generatorAsync) : undefined
    if (builtin === undefined && !custom) throw typeError("yield* requires a compatible iterable value.", node)
    // An async generator delegates to a synchronous iterator through CreateAsyncFromSyncIterator, as JS does.
    const iterator = this.generatorAsync && !custom?.asynchronous ? this.asyncFromSync(builtin, custom, node) : custom!
    let kind: GeneratorRequest["kind"] = "next"
    let input: Value = undefined
    while (true) {
      const method = kind === "next" ? iterator.next : get(iterator.iterator, kind)
      if (method === undefined || method === null) {
        if (kind === "return")
          throw new GeneratorReturn(this.generatorAsync ? yield* this.awaitValue(input, node) : input)
        yield* this.closeIterator(iterator, node)
        throw typeError("The delegated iterator does not provide a throw() method.", node)
      }
      const called = yield* this.call(
        this.requireIteratorMethod(method, `Iterator ${kind}`, node),
        iterator.iterator,
        [input],
        node,
      )
      const result = this.requireIteratorObject(
        iterator.asynchronous ? yield* this.awaitValue(called, node) : called,
        `Iterator ${kind}() result`,
        node,
      )
      const done = Boolean(get(result, "done"))
      const resultValue = get(result, "value")
      if (done) {
        if (kind === "return") throw new GeneratorReturn(resultValue)
        return resultValue
      }

      try {
        // Delegated values are yielded as they are; an async generator's inner promise already settled them.
        input = yield* this.suspendGenerator(resultValue)
        kind = "next"
      } catch (error) {
        if (!(error instanceof GeneratorReturn) && !(error instanceof Throw)) throw error
        kind = error instanceof GeneratorReturn ? "return" : "throw"
        input = error.value
      }
    }
  }

  private *evaluateObjectExpression(node: ObjectExpression): Eval<Obj> {
    const objectValue = new Obj(this.ctx.builtins.Object)
    for (const property of node.properties) {
      if (property.type === "SpreadElement") {
        const spread = yield* this.evaluateExpression(property.argument)
        if (spread === null || spread === undefined) continue
        assign(objectValue, enumerableSource(this.ctx, "Object spread", spread, property))
        continue
      }

      if (property.kind !== "init") {
        throw typeError("Only init object properties are supported.", property)
      }

      const keyNode = property.key

      let key: PropertyKey

      if (property.computed) {
        key = yield* this.toPropertyKey(yield* this.evaluateExpression(keyNode), keyNode)
      } else if (keyNode.type === "Identifier") {
        key = keyNode.name
      } else if (keyNode.type === "Literal") {
        key = propertyKey(literal(keyNode))
      } else {
        throw typeError("Unsupported object property key shape.", keyNode)
      }

      const name =
        key === IteratorSymbol
          ? "[Symbol.iterator]"
          : key === AsyncIteratorSymbol
            ? "[Symbol.asyncIterator]"
            : String(key)
      define(objectValue, key, yield* this.evaluateNamed(property.value, name))
    }

    return objectValue
  }

  private *evaluateArrayExpression(node: ArrayExpression): Eval<Arr> {
    const values: Array<Value> = []

    for (const element of node.elements) {
      if (element === null) {
        // A literal elision is a real hole, like JS: extend length without an own index.
        values.length += 1
        continue
      }
      if (element.type === "SpreadElement") {
        const spread = yield* this.evaluateExpression(element.argument)
        const cursor = yield* this.iterate(spread, element)
        if (cursor === undefined) throw typeError("Array spread requires a synchronous iterable.", element)
        while (true) {
          const step = yield* cursor.next()
          if (step.done) break
          values.push(step.value)
        }
      } else {
        values.push(yield* this.evaluateExpression(element))
      }
    }
    return new Arr(this.ctx.builtins.Array, values)
  }

  private *evaluateTemplateLiteral(node: TemplateLiteral): Eval<string> {
    const quasis = node.quasis
    const expressions = node.expressions

    let output = ""

    for (let index = 0; index < quasis.length; index += 1) {
      const quasi = quasis[index]!
      // acorn only omits `cooked` for invalid escapes, which are a parse error outside a tagged template.
      if (typeof quasi.value.cooked !== "string") {
        throw typeError("Invalid template literal quasi.", quasi)
      }
      output += quasi.value.cooked
      checkStringLength(output.length)

      if (index < expressions.length) {
        const raw = yield* this.evaluateExpression(expressions[index])
        output += coerceToString(yield* this.toPrimitive(raw, "string", expressions[index]))
        checkStringLength(output.length)
      }
    }

    return output
  }

  // `tag\`a${x}b\`` is `tag(strings, x)`: the tag is read like a callee (a member keeps its receiver), the
  // substitutions are evaluated in order, and `strings` carries the escaped source as `strings.raw`.
  private *evaluateTaggedTemplate(node: TaggedTemplateExpression): Eval<Value> {
    const { callable, thisValue } =
      node.tag.type === "MemberExpression"
        ? yield* this.readMethod(node.tag)
        : { callable: yield* this.evaluateExpression(node.tag), thisValue: undefined }
    const strings = this.ctx.templates.get(node) ?? this.createTemplateObject(node)
    const values: Array<Value> = []
    for (const expression of node.quasi.expressions) values.push(yield* this.evaluateExpression(expression))
    return yield* this.call(callable, thisValue, [strings, ...values], node, node.tag)
  }

  private createTemplateObject(node: TaggedTemplateExpression): Arr {
    const array = this.ctx.builtins.Array
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
    this.ctx.templates.set(node, strings)
    return strings
  }

  private *getMemberReference(
    node: MemberExpression,
    object: Value | Eval<Value> | typeof unevaluated = unevaluated,
    key: Value | Eval<Value> | typeof unevaluated = unevaluated,
  ): Eval<Reference> {
    const objectNode = node.object
    const propertyNode = node.property
    if (objectNode.type === "Super") throw unsupportedSyntax(objectNode.type, objectNode)
    if (propertyNode.type === "PrivateIdentifier") throw unsupportedSyntax(propertyNode.type, propertyNode)
    const evaluated = object === unevaluated ? this.evaluate(objectNode) : object
    const objectValue = isEval(evaluated) ? yield* evaluated : evaluated
    if (objectValue === OptionalShortCircuit) return OptionalShortCircuit
    if ((objectValue === null || objectValue === undefined) && node.optional) return OptionalShortCircuit

    const computed =
      key !== unevaluated
        ? key
        : !node.computed && propertyNode.type === "Identifier"
          ? propertyNode.name
          : this.evaluate(propertyNode)
    const keyValue = isEval(computed) ? yield* computed : computed
    const reference = this.memberReference(node, objectValue, keyValue)
    return isEval(reference) ? yield* reference : reference
  }

  // The reference once the object and key are evaluated: ToPropertyKey on an object key may run program code.
  // GetValue applies ToObject to the base before ToPropertyKey, so a nullish base throws before the key's own
  // toString runs.
  private memberReference(node: MemberExpression, objectValue: Value, keyValue: Value): Reference | Eval<Reference> {
    if (objectValue === null || objectValue === undefined) {
      throw typeError(`Cannot read properties of ${objectValue} (reading '${coerceToString(keyValue)}').`, node.object)
    }
    if (keyValue instanceof Obj) return this.resolveAfterKey(node, objectValue, keyValue)
    return this.resolveProperty(objectValue, propertyKey(keyValue), node.object, node.property)
  }

  private *resolveAfterKey(node: MemberExpression, objectValue: Value, keyValue: Obj): Eval<Reference> {
    const key = yield* this.toPropertyKey(keyValue, node.property)
    return this.resolveProperty(objectValue, key, node.object, node.property)
  }

  private readResolved(node: MemberExpression, reference: Reference): Value {
    if (reference === OptionalShortCircuit) return OptionalShortCircuit
    if (reference instanceof ToolReference) return reference
    if ("value" in reference) return reference.value
    return this.readReference(reference, node)
  }

  private resolveProperty(
    objectValue: Value,
    key: PropertyKey,
    objectNode: AstNode,
    propertyNode: AstNode,
  ): MemberReference | ToolReference | { value: Value } {
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
    const proto = primitivePrototype(this.ctx.builtins, objectValue)
    if (proto !== undefined) return { target: proto, key, receiver: objectValue }

    if (objectValue === null || objectValue === undefined) {
      throw typeError(`Cannot read properties of ${objectValue} (reading '${String(key)}').`, objectNode)
    }
    throw typeError("Cannot access a property on a non-object value.", objectNode)
  }

  // One destructured property, read the way a member expression would read it (primitives use their prototype).
  private destructuredProperty(source: Value, key: PropertyKey, node: AstNode): Value {
    const reference = this.resolveProperty(source, key, node, node)
    if (reference instanceof ToolReference) return reference
    if ("value" in reference) return reference.value
    return this.readProperty(reference.target, reference.key, node, reference.receiver)
  }

  private readReference(reference: MemberReference, node: MemberExpression): Value {
    // Reject unknown promise properties so a missing await cannot hide.
    if (reference.target instanceof PromiseObj && !has(reference.target, reference.key)) {
      throw invalidData(
        "This value is an un-awaited Promise; await it first - e.g. `const result = await tools.ns.tool(...)`.",
        node.object,
      )
    }
    return this.readProperty(reference.target, reference.key, node, reference.receiver)
  }

  // Accessors throw without a location; the member or pattern that read them supplies it.
  private readProperty(target: Obj, key: PropertyKey, node: AstNode, receiver: Value = target): Value {
    try {
      return get(target, key, receiver)
    } catch (error) {
      throw locate(error, node)
    }
  }

  private *readMember(
    node: MemberExpression,
    object: Value | Eval<Value> | typeof unevaluated = unevaluated,
    key: Value | Eval<Value> | typeof unevaluated = unevaluated,
  ): Eval<Value> {
    return this.readResolved(node, yield* this.getMemberReference(node, object, key))
  }

  private writeMember(node: MemberExpression, value: Value): Eval<Value> {
    return this.modifyMember(node, function* () {
      return { write: true, next: value, result: value }
    })
  }

  private *evaluateDeleteExpression(argument: Expression): Eval<boolean> {
    const target = argument.type === "ChainExpression" ? argument.expression : argument
    if (target.type === "Identifier") throw typeError("Only data fields may be deleted.", argument)
    // `delete <non-reference>` evaluates the operand and is true, as in JS.
    if (target.type !== "MemberExpression") {
      yield* this.evaluateExpression(target)
      return true
    }
    const reference = yield* this.getMemberReference(target)
    if (reference === OptionalShortCircuit) return true
    if (reference instanceof ToolReference || "value" in reference || reference.receiver !== reference.target) {
      throw invalidData("Only data fields may be deleted.", target)
    }
    if (remove(reference.target, reference.key)) return true
    throw typeError(`Cannot delete property '${String(reference.key)}'.`, target)
  }

  // Resolve side-effecting object and key expressions exactly once.
  private *modifyMember(
    node: MemberExpression,
    compute: (current: Value) => Eval<{ write: boolean; next: Value; result: Value }>,
  ): Eval<Value> {
    const reference = yield* this.getMemberReference(node)
    if (reference === OptionalShortCircuit || reference instanceof ToolReference || "value" in reference) {
      throw typeError("Only data fields may be assigned.", node)
    }
    if (reference.receiver !== reference.target) {
      throw typeError(
        `Cannot create property '${String(reference.key)}' on ${typeof reference.receiver} '${String(reference.receiver)}'.`,
        node,
      )
    }
    const key = reference.key
    const { write, next, result } = yield* compute(this.readReference(reference, node))
    if (write) this.assignToReference(reference.target, key, next, node)
    return result
  }

  private assignToReference(target: Obj, key: PropertyKey, next: Value, node: AstNode): void {
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

  // ToPropertyKey: a data object converts through its own `toString`/`valueOf` first; anything else becomes its
  // string form synchronously, so `counts[row.category]` works when the field is null.
  private *toPropertyKey(value: Value, node: AstNode): Eval<PropertyKey> {
    if (!(value instanceof Obj)) return propertyKey(value)
    return propertyKey(yield* this.toPrimitive(value, "string", node))
  }
}

// The body a generator object resumes: a `return()` request ends it with the returned value.
function* generatorBody(body: Eval<Value>): Eval<Value> {
  try {
    return yield* body
  } catch (error) {
    if (error instanceof GeneratorReturn) return error.value
    throw error
  }
}

// Rethrows inside interpreter work, so a failure already caught can pass through `preserveConsumerError`.
function* thrower(error: unknown): Eval<never> {
  throw error
}

// Finishes a built-in's work, locating a failure at the call that started it.
function* located(work: Eval<Value>, node: AstNode | undefined): Eval<Value> {
  try {
    return yield* work
  } catch (error) {
    throw locate(error, node)
  }
}

// Lets the host run first, then starts the work.
function* afterSlice(start: () => Value | Eval<Value>): Eval<Value> {
  yield Slice
  const result = start()
  return isEval(result) ? yield* result : result
}
