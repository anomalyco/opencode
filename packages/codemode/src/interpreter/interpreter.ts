import type {
  ArrayExpression,
  ArrayPattern,
  AssignmentPattern,
  ArrowFunctionExpression,
  AssignmentExpression,
  AssignmentProperty,
  BinaryExpression,
  BlockStatement,
  BreakStatement,
  CallExpression,
  ConditionalExpression,
  ContinueStatement,
  DoWhileStatement,
  Expression,
  ForInStatement,
  ForOfStatement,
  ForStatement,
  FunctionDeclaration,
  FunctionExpression,
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
import { Cause, Deferred, Effect, Exit } from "effect"
import { fromJson, type Json, toBoundary } from "../data.js"
import { ToolReference, type ToolRuntime } from "../tool-runtime.js"
import {
  type AstNode,
  AsyncIteratorSymbol,
  type Binding,
  CallSite,
  type GeneratorRequestKind,
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
  Arr,
  Fn,
  GeneratorObj,
  Obj,
  PromiseObj,
  record,
  remove,
  set,
  coerceToNumber,
  coerceToString,
  type Value,
} from "./objects.js"
import { preserveConsumerError } from "./callback.js"
import { Pending, resolvePromise, resolvePromiseValue } from "./promises.js"
import { containsOpaqueReference, describeValue, rejectCircularInsertion, typeofValue } from "./references.js"
import { ScopeStack } from "./scope.js"
import { constructRegExp } from "../stdlib/regexp.js"
import { enumerableSource } from "../stdlib/object.js"
import { compoundOperators } from "../stdlib/value.js"

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

type GeneratorRequest = {
  kind: GeneratorRequestKind
  value: Value
  response: Deferred.Deferred<Value, unknown>
}

type GeneratorState = {
  started: boolean
  completed: boolean
  draining: boolean
  active?: GeneratorRequest
  pending: Array<GeneratorRequest>
  pendingIndex: number
  available?: Deferred.Deferred<void>
}

/** One program execution: the tool bridge, promise scheduler, captured logs, and the global scope built once. */
export class Interpreter<R> {
  readonly tools: ToolRuntime<R>
  readonly pending: Pending<R>
  readonly builtins: Builtins
  readonly logs: Array<string>
  /** Template objects by site: a tag sees the same `strings` array every time its literal is evaluated, as in JS. */
  readonly templates = new WeakMap<TaggedTemplateExpression, Arr>()
  private readonly root: Frame<R>

  constructor(options: {
    readonly tools: ToolRuntime<R>
    readonly pending: Pending<R>
    readonly builtins: Builtins
    readonly logs?: Array<string>
    readonly globals?: (ctx: Interpreter<R>) => ReadonlyArray<readonly [string, Value]>
  }) {
    this.tools = options.tools
    this.pending = options.pending
    this.builtins = options.builtins
    this.logs = options.logs ?? []
    const globalScope = new Map<string, Binding>()
    // Calling back into the program never reads frame state, so any frame serves; the root is always alive.
    this.root = new Frame(this, new ScopeStack([globalScope]))
    for (const [name, value] of [...globals(this), ...(options.globals?.(this) ?? [])]) {
      globalScope.set(name, { mutable: false, value })
    }
  }

  run(program: Program): Effect.Effect<Value, unknown, R> {
    return this.root.run(program)
  }

  call(callable: Value, thisValue: Value, args: Array<Value>): Effect.Effect<Value, unknown, R> {
    return this.root.call(callable, thisValue, args)
  }

  await(promise: PromiseObj): Effect.Effect<Value, unknown, never> {
    return this.root.await(promise)
  }

  iterate(value: Value) {
    return this.root.iterate(value)
  }

  iterateDirect(value: Value) {
    return this.root.iterateDirect(value)
  }

  /** Runs one host tool: arguments cross as JSON and the result comes back as program values. */
  tool(
    run: (args: Array<Json | undefined>) => Effect.Effect<Json | undefined, unknown, R>,
    args: Array<Value>,
  ): Effect.Effect<Value, unknown, R> {
    const ctx = this
    return Effect.gen(function* () {
      const json = yield* Effect.forEach(args, (arg) => toBoundary(ctx, arg))
      return fromJson(ctx, yield* run(json))
    })
  }
}

const MAX_CALL_DEPTH = 10_000

/** One activation: the top-level program or a single function call, evaluating against its own scope chain. */
class Frame<R> {
  private generatorState?: GeneratorState
  private generatorAsync = false

  constructor(
    private readonly ctx: Interpreter<R>,
    private scopes: ScopeStack,
    /** Nested call depth; resets when an await resumes, since the continuation runs from the job queue. */
    private depth = 0,
  ) {}

  run(program: Program): Effect.Effect<Value, unknown, R> {
    const self = this
    // Keep top-level declarations separate so they can shadow builtins.
    this.scopes.push()
    return Effect.gen(function* () {
      self.predeclareLexical(program.body)
      self.hoistFunctions(program.body)
      self.hoistVars(program.body)
      let value: Value = undefined
      for (const [index, statement] of program.body.entries()) {
        if (index === program.body.length - 1 && statement.type === "ExpressionStatement") {
          value = yield* self.evaluateExpression(statement.expression)
          break
        }
        const result = yield* self.evaluateStatement(statement)

        if (result.kind === "return") {
          value = result.value
          break
        }

        if (result.kind === "break" || result.kind === "continue") {
          throw typeError(`Unexpected '${result.kind}' outside of a loop.`, statement)
        }
      }

      // The implicit async body adopts returned promises before copy-out.
      value = yield* resolvePromiseValue(self.ctx, value)
      return value
    }).pipe(Effect.ensuring(Effect.sync(() => self.scopes.pop())))
  }

  // Fork at the call site so admission and hooks occur when the call is made.
  private createToolCallPromise(path: ReadonlyArray<string>, args: Array<Value>): Effect.Effect<PromiseObj, never, R> {
    return this.ctx.pending.create(this.ctx.tool((json) => this.ctx.tools.execute(path, json), args))
  }

  // Fiber exits make settlement idempotent; yielding prevents inline continuation.
  await(promise: PromiseObj): Effect.Effect<Value, unknown, never> {
    const pending = this.ctx.pending
    return Effect.suspend(() => {
      pending.markObserved(promise)
      return Effect.flatMap(pending.await(promise), (exit) => Effect.andThen(Effect.yieldNow, exit))
    })
  }

  private evaluateStatement(node: Statement | ModuleDeclaration): Effect.Effect<StatementResult, unknown, R> {
    switch (node.type) {
      case "ExpressionStatement":
        return Effect.as(this.evaluateExpression(node.expression), { kind: "none" })
      case "VariableDeclaration":
        return Effect.map(this.evaluateVariableDeclaration(node), () => ({ kind: "none" }))
      case "ReturnStatement": {
        const argumentNode = node.argument
        return argumentNode
          ? Effect.map(this.evaluateExpression(argumentNode), (value) => ({ kind: "return", value }))
          : Effect.succeed({ kind: "return", value: undefined })
      }
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
        return Effect.succeed(this.evaluateBreakStatement(node))
      case "ContinueStatement":
        return Effect.succeed(this.evaluateContinueStatement(node))
      case "ThrowStatement":
        return this.evaluateThrowStatement(node)
      case "TryStatement":
        return this.evaluateTryStatement(node)
      case "EmptyStatement":
        return Effect.succeed({ kind: "none" })
      case "FunctionDeclaration":
        return Effect.succeed({ kind: "none" })
      default:
        throw unsupportedSyntax(node.type, node)
    }
  }

  private evaluateBlock(node: BlockStatement): Effect.Effect<StatementResult, unknown, R> {
    this.scopes.push()
    const self = this
    return Effect.gen(function* () {
      const body = node.body
      self.predeclareLexical(body)
      self.hoistFunctions(body)

      for (const statement of body) {
        const result = yield* self.evaluateStatement(statement)

        if (result.kind !== "none") {
          return result
        }
      }

      return { kind: "none" } satisfies StatementResult
    }).pipe(Effect.ensuring(Effect.sync(() => self.scopes.pop())))
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
  private evaluateNamed(node: Expression, name: string): Effect.Effect<Value, unknown, R> {
    if (node.type === "ArrowFunctionExpression" || (node.type === "FunctionExpression" && !node.id)) {
      return Effect.sync(() => this.createFunction(node, name))
    }
    return this.evaluateExpression(node)
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

  private evaluateIfStatement(node: IfStatement): Effect.Effect<StatementResult, unknown, R> {
    return Effect.flatMap(this.evaluateExpression(node.test), (test) =>
      test
        ? this.evaluateStatement(node.consequent)
        : node.alternate
          ? this.evaluateStatement(node.alternate)
          : Effect.succeed({ kind: "none" }),
    )
  }

  private evaluateSwitchStatement(node: SwitchStatement): Effect.Effect<StatementResult, unknown, R> {
    const self = this
    return Effect.gen(function* () {
      const discriminant = yield* self.evaluateExpression(node.discriminant)
      if (containsOpaqueReference(discriminant)) {
        throw invalidData("Switch discriminants must be data values.", node)
      }
      self.scopes.push()
      return yield* Effect.gen(function* () {
        const cases = node.cases
        const statements = cases.flatMap((branch) => branch.consequent)
        self.predeclareLexical(statements)
        self.hoistFunctions(statements)
        let defaultIndex: number | undefined
        let selected: number | undefined
        for (const [index, branch] of cases.entries()) {
          const test = branch.test
          if (!test) {
            defaultIndex = index
            continue
          }
          const candidate = yield* self.evaluateExpression(test)
          if (containsOpaqueReference(candidate)) {
            throw invalidData("Switch case values must be data values.", test)
          }
          if (candidate === discriminant) {
            selected = index
            break
          }
        }
        const start = selected ?? defaultIndex
        if (start === undefined) return { kind: "none" } satisfies StatementResult
        for (let index = start; index < cases.length; index += 1) {
          for (const statement of cases[index]!.consequent) {
            const result = yield* self.evaluateStatement(statement)
            if (result.kind === "break") {
              if (result.label === undefined) return { kind: "none" } satisfies StatementResult
              return result
            }
            if (result.kind === "return" || result.kind === "continue") return result
          }
        }
        return { kind: "none" } satisfies StatementResult
      }).pipe(Effect.ensuring(Effect.sync(() => self.scopes.pop())))
    })
  }

  private evaluateWhileStatement(
    node: WhileStatement,
    labels?: ReadonlySet<string>,
  ): Effect.Effect<StatementResult, unknown, R> {
    const self = this
    return Effect.gen(function* () {
      while (yield* self.evaluateExpression(node.test)) {
        const exit = loopExit(yield* self.evaluateStatement(node.body), labels)
        if (exit !== undefined) return exit
      }

      return { kind: "none" } satisfies StatementResult
    })
  }

  private evaluateDoWhileStatement(
    node: DoWhileStatement,
    labels?: ReadonlySet<string>,
  ): Effect.Effect<StatementResult, unknown, R> {
    const self = this
    return Effect.gen(function* () {
      do {
        const exit = loopExit(yield* self.evaluateStatement(node.body), labels)
        if (exit !== undefined) return exit
      } while (yield* self.evaluateExpression(node.test))

      return { kind: "none" } satisfies StatementResult
    })
  }

  private evaluateForStatement(
    node: ForStatement,
    labels?: ReadonlySet<string>,
  ): Effect.Effect<StatementResult, unknown, R> {
    this.scopes.push()
    const self = this
    return Effect.gen(function* () {
      const initNode = node.init
      const testNode = node.test
      const updateNode = node.update

      if (initNode?.type === "VariableDeclaration" && initNode.kind !== "var") {
        self.predeclareLexical([initNode])
      }

      if (initNode) {
        if (initNode.type === "VariableDeclaration") {
          yield* self.evaluateVariableDeclaration(initNode)
        } else {
          yield* self.evaluateExpression(initNode)
        }
      }

      const perIterationBindings =
        initNode?.type === "VariableDeclaration" && initNode.kind !== "var"
          ? Array.from(self.scopes.current().keys())
          : []

      const nextIteration = () => {
        if (perIterationBindings.length === 0) return
        const current = self.scopes.current()
        self.scopes.pop()
        self.scopes.push(
          new Map(perIterationBindings.map((name): [string, Binding] => [name, { ...current.get(name)! }])),
        )
      }
      nextIteration()

      while (testNode ? yield* self.evaluateExpression(testNode) : true) {
        const exit = loopExit(yield* self.evaluateStatement(node.body), labels)
        if (exit !== undefined) return exit

        nextIteration()
        if (updateNode) {
          yield* self.evaluateExpression(updateNode)
        }
      }

      return { kind: "none" } satisfies StatementResult
    }).pipe(Effect.ensuring(Effect.sync(() => self.scopes.pop())))
  }

  private evaluateForOfStatement(
    node: ForOfStatement,
    labels?: ReadonlySet<string>,
  ): Effect.Effect<StatementResult, unknown, R> {
    const awaiting = node.await
    const left = node.left
    const declared = loopDeclaration(left, "for...of")
    if (declared?.lexical) this.scopes.push()

    const self = this
    return Effect.gen(function* () {
      if (declared?.lexical) self.predeclarePattern(declared.pattern, declared.mutable, left)
      const right = yield* self.evaluateExpression(node.right)

      const cursor = self.builtinCursor(right)
      const iterator = cursor === undefined ? yield* self.customIterator(right, node, awaiting) : undefined
      if (iterator === undefined && cursor === undefined) {
        throw invalidData(
          `${awaiting ? "for await...of" : "for...of"} requires an iterable value, received ${describeValue(right)}.`,
          node,
        )
      }
      const close = () =>
        iterator
          ? self.closeIterator(iterator, node, awaiting)
          : awaiting
            ? Effect.andThen(cursor?.close ?? Effect.void, Effect.yieldNow)
            : (cursor?.close ?? Effect.void)

      if (left.type === "RestElement" || left.type === "AssignmentPattern") {
        throw typeError("Unsupported for...of binding.", left)
      }
      const assignment = left.type === "VariableDeclaration" ? undefined : left

      const evaluateBody = (value: Value) =>
        Effect.gen(function* () {
          if (declared?.lexical) {
            self.scopes.push()
            self.predeclarePattern(declared.pattern, declared.mutable, left)
            yield* self.declarePattern(declared.pattern, value, declared.mutable, left, true)
          } else if (declared) {
            yield* self.assignPattern(declared.pattern, value, left)
          } else if (assignment) {
            yield* self.assignPattern(assignment, value, left)
          }
          return yield* self.evaluateStatement(node.body)
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              if (declared?.lexical) self.scopes.pop()
            }),
          ),
        )

      while (true) {
        const current = iterator
          ? yield* self.nextIteratorResult(iterator, node, awaiting)
          : yield* cursor?.next ?? Effect.die(typeError("Iterator is unavailable.", node))
        const step = cursor && awaiting ? { done: current.done, value: yield* self.awaitValue(current.value) } : current
        if (step.done) return { kind: "none" } satisfies StatementResult
        const bodyExit = yield* Effect.exit(evaluateBody(step.value))
        if (!Exit.isSuccess(bodyExit)) {
          // Process interruption must remain prompt; user cleanup cannot extend a timeout.
          if (Cause.hasInterruptsOnly(bodyExit.cause)) return yield* Effect.failCause(bodyExit.cause)
          return yield* preserveConsumerError(close(), Effect.failCause(bodyExit.cause))
        }
        const exit = loopExit(bodyExit.value, labels)
        if (exit !== undefined) {
          yield* close()
          return exit
        }
      }
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (declared?.lexical) self.scopes.pop()
        }),
      ),
    )
  }

  private awaitValue(value: Value): Effect.Effect<Value, unknown, R> {
    return Effect.flatMap(resolvePromise(this.ctx, value), (promise) =>
      Effect.ensuring(
        this.await(promise),
        Effect.sync(() => (this.depth = 0)),
      ),
    )
  }

  private awaitAsyncFromSyncValue(
    iterator: CustomIterator,
    value: Value,
    node: AstNode | undefined,
    closeOnRejection: boolean,
  ): Effect.Effect<Value, unknown, R> {
    const self = this
    return Effect.gen(function* () {
      const settled = yield* Effect.exit(self.awaitValue(value))
      if (Exit.isSuccess(settled)) return settled.value
      if (closeOnRejection && !Cause.hasInterruptsOnly(settled.cause)) {
        yield* Effect.exit(self.closeIterator(iterator, node, false))
      }
      return yield* Effect.failCause(settled.cause)
    })
  }

  iterate(value: Value, node?: AstNode): Effect.Effect<Cursor<R> | undefined, unknown, R> {
    const cursor = this.builtinCursor(value)
    if (cursor !== undefined) return Effect.succeed(cursor)
    return Effect.map(this.customIterator(value, node, false), (iterator) =>
      iterator === undefined ? undefined : this.customCursor(iterator, node),
    )
  }

  /** GetIteratorDirect: drive an iterator by its own `next`, without asking for `[Symbol.iterator]`. */
  iterateDirect(value: Value, node?: AstNode): Cursor<R> {
    if (value instanceof IteratorObj) return value.cursor as Cursor<R>
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

  private customCursor(iterator: CustomIterator, node: AstNode | undefined): Cursor<R> {
    return {
      next: this.nextIteratorResult(iterator, node, false),
      close: Effect.suspend(() => this.closeIterator(iterator, node, false)),
    }
  }

  private builtinCursor(value: Value): Cursor<R> | undefined {
    // Natives build their cursors without knowing R, like `lift` in native.ts.
    if (value instanceof IteratorObj) return value.cursor as Cursor<R>
    const iterator =
      typeof value === "string"
        ? value[Symbol.iterator]()
        : value instanceof Obj
          ? value.iterator(this.ctx.builtins)
          : undefined
    return iterator === undefined ? undefined : hostCursor(iterator)
  }

  private customIterator(value: Value, node: AstNode | undefined, allowAsync = true) {
    if (!(value instanceof Obj)) return Effect.undefined
    const asyncMethod = allowAsync ? get(value, AsyncIteratorSymbol) : undefined
    const method = asyncMethod ?? get(value, IteratorSymbol)
    if (method === undefined || method === null) return Effect.undefined
    const self = this
    return Effect.map(
      this.call(this.requireIteratorMethod(method, "Iterator method", node), value, [], node),
      (iterator) => {
        const object = self.requireIteratorObject(iterator, "Iterator method result", node)
        return {
          iterator: object,
          next: self.requireIteratorMethod(get(object, "next"), "Iterator next", node),
          asynchronous: asyncMethod !== undefined && asyncMethod !== null,
        }
      },
    )
  }

  private nextIteratorResult(iterator: CustomIterator, node: AstNode | undefined, awaiting: boolean) {
    const self = this
    return Effect.gen(function* () {
      if (iterator.asynchronous) {
        const object = self.requireIteratorObject(
          yield* self.awaitValue(yield* self.call(iterator.next, iterator.iterator, [], node)),
          "Iterator next() result",
          node,
        )
        return { done: Boolean(get(object, "done")), value: get(object, "value") }
      }

      const called = yield* Effect.exit(self.call(iterator.next, iterator.iterator, [], node))
      if (!Exit.isSuccess(called)) {
        if (awaiting) yield* Effect.yieldNow
        return yield* Effect.failCause(called.cause)
      }
      const captured = yield* Effect.exit(
        Effect.sync(() => {
          const object = self.requireIteratorObject(called.value, "Iterator next() result", node)
          return { done: Boolean(get(object, "done")), value: get(object, "value") }
        }),
      )
      if (!Exit.isSuccess(captured)) {
        if (awaiting) yield* Effect.yieldNow
        return yield* Effect.failCause(captured.cause)
      }
      return {
        done: captured.value.done,
        value: awaiting
          ? yield* self.awaitAsyncFromSyncValue(iterator, captured.value.value, node, !captured.value.done)
          : captured.value.value,
      }
    })
  }

  private closeIterator(
    iterator: CustomIterator,
    node: AstNode | undefined,
    awaiting = true,
  ): Effect.Effect<void, unknown, R> {
    const close = get(iterator.iterator, "return")
    if (close === undefined || close === null) return iterator.asynchronous || !awaiting ? Effect.void : Effect.yieldNow
    const self = this
    return Effect.gen(function* () {
      const method = self.requireIteratorMethod(close, "Iterator return", node)
      if (iterator.asynchronous) {
        self.requireIteratorObject(
          yield* self.awaitValue(yield* self.call(method, iterator.iterator, [], node)),
          "Iterator return() result",
          node,
        )
        return
      }

      const called = yield* Effect.exit(self.call(method, iterator.iterator, [], node))
      if (!Exit.isSuccess(called)) {
        if (awaiting) yield* Effect.yieldNow
        return yield* Effect.failCause(called.cause)
      }
      const captured = yield* Effect.exit(
        Effect.sync(() => get(self.requireIteratorObject(called.value, "Iterator return() result", node), "value")),
      )
      if (!Exit.isSuccess(captured)) {
        if (awaiting) yield* Effect.yieldNow
        return yield* Effect.failCause(captured.cause)
      }
      if (awaiting) yield* self.awaitValue(captured.value)
    })
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

  private evaluateForInStatement(
    node: ForInStatement,
    labels?: ReadonlySet<string>,
  ): Effect.Effect<StatementResult, unknown, R> {
    const left = node.left
    const declared = loopDeclaration(left, "for...in")
    if (declared?.lexical) this.scopes.push()

    const self = this
    return Effect.gen(function* () {
      if (declared?.lexical) self.predeclarePattern(declared.pattern, declared.mutable, left)
      const right = yield* self.evaluateExpression(node.right)

      const keys = self.enumerableKeys(right, node.right)

      if (left.type !== "Identifier" && left.type !== "VariableDeclaration") {
        throw typeError("Unsupported for...in binding.", left)
      }
      const assignmentName = left.type === "Identifier" ? left.name : undefined

      for (const key of keys) {
        const result = yield* Effect.gen(function* () {
          if (declared?.lexical) {
            self.scopes.push()
            self.predeclarePattern(declared.pattern, declared.mutable, left)
            yield* self.declarePattern(declared.pattern, key, declared.mutable, left, true)
          } else if (declared) {
            yield* self.assignPattern(declared.pattern, key, left)
          } else if (assignmentName) {
            self.scopes.set(assignmentName, key, left)
          }
          return yield* self.evaluateStatement(node.body)
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              if (declared?.lexical) self.scopes.pop()
            }),
          ),
        )

        const exit = loopExit(result, labels)
        if (exit !== undefined) return exit
      }

      return { kind: "none" } satisfies StatementResult
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (declared?.lexical) self.scopes.pop()
        }),
      ),
    )
  }

  private evaluateBreakStatement(node: BreakStatement): StatementResult {
    return node.label ? { kind: "break", label: node.label.name } : { kind: "break" }
  }

  private evaluateContinueStatement(node: ContinueStatement): StatementResult {
    return node.label ? { kind: "continue", label: node.label.name } : { kind: "continue" }
  }

  private evaluateLabeledStatement(node: LabeledStatement): Effect.Effect<StatementResult, unknown, R> {
    const labels = new Set<string>()
    let body: Statement = node
    while (body.type === "LabeledStatement") {
      labels.add(body.label.name)
      body = body.body
    }

    const evaluated = (() => {
      if (body.type === "WhileStatement") return this.evaluateWhileStatement(body, labels)
      if (body.type === "DoWhileStatement") return this.evaluateDoWhileStatement(body, labels)
      if (body.type === "ForStatement") return this.evaluateForStatement(body, labels)
      if (body.type === "ForOfStatement") return this.evaluateForOfStatement(body, labels)
      if (body.type === "ForInStatement") return this.evaluateForInStatement(body, labels)
      return this.evaluateStatement(body)
    })()

    return Effect.map(evaluated, (result) =>
      result.kind === "break" && result.label !== undefined && labels.has(result.label)
        ? ({ kind: "none" } satisfies StatementResult)
        : result,
    )
  }

  private evaluateThrowStatement(node: ThrowStatement): Effect.Effect<StatementResult, unknown, R> {
    return Effect.flatMap(this.evaluateExpression(node.argument), (value) => Effect.fail(new Throw(value)))
  }

  private evaluateTryStatement(node: TryStatement): Effect.Effect<StatementResult, unknown, R> {
    const body = node.block
    const handler = node.handler
    const finalizer = node.finalizer
    const self = this

    const attempted = Effect.matchCauseEffect(this.evaluateStatement(body), {
      onFailure: (cause) => {
        if (cause.reasons.some(Cause.isInterruptReason) || Cause.squash(cause) instanceof GeneratorReturn || !handler) {
          return Effect.failCause(cause)
        }

        const caught = materialize(self.ctx, Cause.squash(cause))
        const parameter = handler.param
        self.scopes.push()
        return Effect.gen(function* () {
          if (parameter) yield* self.declarePattern(parameter, caught, true, handler)
          return yield* self.evaluateStatement(handler.body)
        }).pipe(Effect.ensuring(Effect.sync(() => self.scopes.pop())))
      },
      onSuccess: Effect.succeed,
    })

    if (!finalizer) return attempted

    const isAbrupt = (result: StatementResult): boolean =>
      result.kind === "return" || result.kind === "break" || result.kind === "continue"

    return Effect.matchCauseEffect(attempted, {
      onFailure: (cause) =>
        cause.reasons.some(Cause.isInterruptReason)
          ? Effect.failCause(cause)
          : Effect.flatMap(this.evaluateStatement(finalizer), (final) =>
              isAbrupt(final) ? Effect.succeed(final) : Effect.failCause(cause),
            ),
      onSuccess: (result) =>
        Effect.flatMap(this.evaluateStatement(finalizer), (final) =>
          isAbrupt(final) ? Effect.succeed(final) : Effect.succeed(result),
        ),
    })
  }

  private evaluateVariableDeclaration(node: VariableDeclaration): Effect.Effect<void, unknown, R> {
    const kind = node.kind
    const self = this
    return Effect.gen(function* () {
      for (const declaration of node.declarations) {
        if (declaration.type !== "VariableDeclarator") {
          throw typeError("Unsupported variable declaration shape.", declaration)
        }

        const init = declaration.init
        // `var x` alone is a no-op: the binding was hoisted on function entry.
        const id = declaration.id
        const evaluate = (init: Expression) =>
          id.type === "Identifier" ? self.evaluateNamed(init, id.name) : self.evaluateExpression(init)
        if (kind === "var") {
          if (init) yield* self.assignPattern(id, yield* evaluate(init), declaration)
          continue
        }
        const value = init ? yield* evaluate(init) : undefined
        yield* self.declarePattern(declaration.id, value, kind !== "const", declaration, true)
      }
    })
  }

  private declarePattern(
    pattern: Pattern,
    value: Value,
    mutable: boolean,
    node: AstNode,
    initialize = false,
  ): Effect.Effect<void, unknown, R> {
    const self = this
    return Effect.gen(function* () {
      if (pattern.type === "Identifier") {
        const name = pattern.name
        if (initialize) self.scopes.initialize(name, value, node)
        else self.scopes.declare(name, value, mutable, node)
        return
      }

      if (pattern.type === "AssignmentPattern") {
        const resolved = value === undefined ? yield* self.evaluateDefault(pattern) : value
        yield* self.declarePattern(pattern.left, resolved, mutable, node, initialize)
        return
      }

      if (pattern.type === "ObjectPattern") {
        if (!(value instanceof Obj)) {
          throw typeError(
            `Object destructuring requires a data object or array value, received ${describeValue(value)}.`,
            pattern,
          )
        }

        const consumed = new Set<PropertyKey>()
        for (const property of pattern.properties) {
          if (property.type === "RestElement") {
            const rest = new Obj(self.ctx.builtins.Object)
            assign(rest, value, consumed)
            yield* self.declarePattern(property.argument, rest, mutable, property, initialize)
            continue
          }

          const key = yield* self.destructuringPropertyKey(property)
          consumed.add(typeof key === "symbol" ? key : String(key))
          yield* self.declarePattern(
            property.value,
            self.readProperty(value, key, property),
            mutable,
            property,
            initialize,
          )
        }
        return
      }

      if (pattern.type === "ArrayPattern") {
        return yield* self.destructureArrayPattern(pattern, value, (target, item, context) =>
          self.declarePattern(target, item, mutable, context, initialize),
        )
      }

      throw typeError(`Unsupported binding pattern '${pattern.type}'.`, pattern)
    })
  }

  private assignPattern(pattern: Pattern, value: Value, node: AstNode): Effect.Effect<void, unknown, R> {
    const self = this
    return Effect.gen(function* () {
      if (pattern.type === "Identifier") {
        self.scopes.set(pattern.name, value, pattern)
        return
      }

      if (pattern.type === "MemberExpression") {
        yield* self.writeMember(pattern, value)
        return
      }

      if (pattern.type === "AssignmentPattern") {
        const resolved = value === undefined ? yield* self.evaluateDefault(pattern) : value
        yield* self.assignPattern(pattern.left, resolved, node)
        return
      }

      if (pattern.type === "ObjectPattern") {
        if (!(value instanceof Obj)) {
          throw invalidData(
            `Object destructuring requires a data object or array value, received ${describeValue(value)}.`,
            pattern,
          )
        }

        const consumed = new Set<PropertyKey>()
        for (const property of pattern.properties) {
          if (property.type === "RestElement") {
            const rest = new Obj(self.ctx.builtins.Object)
            assign(rest, value, consumed)
            yield* self.assignPattern(property.argument, rest, property)
            continue
          }
          const key = yield* self.destructuringPropertyKey(property)
          consumed.add(typeof key === "symbol" ? key : String(key))
          yield* self.assignPattern(property.value, self.readProperty(value, key, property), property)
        }
        return
      }

      if (pattern.type === "ArrayPattern") {
        return yield* self.destructureArrayPattern(pattern, value, (target, item, context) =>
          self.assignPattern(target, item, context),
        )
      }

      throw typeError(`Unsupported assignment pattern '${pattern.type}'.`, node)
    })
  }

  private evaluateDefault(pattern: AssignmentPattern): Effect.Effect<Value, unknown, R> {
    return pattern.left.type === "Identifier"
      ? this.evaluateNamed(pattern.right, pattern.left.name)
      : this.evaluateExpression(pattern.right)
  }

  private destructureArrayPattern(
    pattern: ArrayPattern,
    value: Value,
    consume: (target: Pattern, value: Value, context: AstNode) => Effect.Effect<void, unknown, R>,
  ): Effect.Effect<void, unknown, R> {
    const self = this
    return Effect.gen(function* () {
      const cursor = yield* self.iterate(value, pattern)
      if (cursor === undefined) {
        throw typeError("Array destructuring requires a supported iterable value.", pattern)
      }
      let done = false
      for (const element of pattern.elements) {
        if (done) {
          if (element === null) continue
          yield* consume(
            element.type === "RestElement" ? element.argument : element,
            element.type === "RestElement" ? new Arr(self.ctx.builtins.Array) : undefined,
            element,
          )
          if (element.type === "RestElement") return
          continue
        }
        const step = yield* cursor.next
        done = step.done
        if (element === null) continue
        if (element.type === "RestElement") {
          const rest: Array<Value> = []
          if (!step.done) rest.push(step.value)
          while (!done) {
            const next = yield* cursor.next
            done = next.done
            if (!done) rest.push(next.value)
          }
          yield* consume(element.argument, new Arr(self.ctx.builtins.Array, rest), element)
          return
        }
        const consumed = consume(element, step.done ? undefined : step.value, pattern)
        yield* step.done ? consumed : preserveConsumerError(cursor.close, consumed)
      }
      if (!done) yield* cursor.close
    })
  }

  private destructuringPropertyKey(property: Property | AssignmentProperty): Effect.Effect<PropertyKey, unknown, R> {
    if (property.type !== "Property" || property.kind !== "init") {
      throw typeError("Unsupported object destructuring property.", property)
    }
    const keyNode = property.key
    if (property.computed) {
      return Effect.map(this.evaluateExpression(keyNode), (value) => this.toPropertyKey(value))
    }
    if (keyNode.type === "Identifier") return Effect.succeed(keyNode.name)
    if (keyNode.type === "Literal") return Effect.succeed(String(keyNode.value))
    throw unsupportedSyntax(keyNode.type, keyNode)
  }

  private evaluateExpression(node: Expression): Effect.Effect<Value, unknown, R> {
    switch (node.type) {
      case "Literal": {
        const regex = node.regex
        if (regex) return Effect.sync(() => constructRegExp(this.ctx.builtins, [regex.pattern, regex.flags]))
        return Effect.succeed(literal(node))
      }
      case "Identifier":
        return Effect.sync(() => this.scopes.get(node.name, node))
      case "BinaryExpression":
        return this.evaluateBinaryExpression(node)
      case "LogicalExpression":
        return this.evaluateLogicalExpression(node)
      case "UnaryExpression":
        return this.evaluateUnaryExpression(node)
      case "AssignmentExpression":
        return this.evaluateAssignmentExpression(node)
      case "SequenceExpression": {
        const self = this
        return Effect.gen(function* () {
          let result: Value
          for (const expression of node.expressions) {
            result = yield* self.evaluateExpression(expression)
          }
          return result
        })
      }
      case "CallExpression":
        return this.evaluateCallExpression(node)
      case "ArrowFunctionExpression":
      case "FunctionExpression":
        return Effect.sync(() => this.createFunction(node))
      case "MemberExpression":
        return this.readMember(node)
      case "ChainExpression":
        return Effect.map(this.evaluateExpression(node.expression), (value) =>
          value === OptionalShortCircuit ? undefined : value,
        )
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
      case "UpdateExpression":
        return this.evaluateUpdateExpression(node)
      case "AwaitExpression": {
        // Await always suspends, including for plain values.
        return Effect.flatMap(this.evaluateExpression(node.argument), (value) => this.awaitValue(value))
      }
      case "YieldExpression":
        return this.evaluateYieldExpression(node)
      case "NewExpression":
        return this.evaluateNewExpression(node)
      default:
        throw unsupportedSyntax(node.type, node)
    }
  }

  private evaluateNewExpression(node: NewExpression): Effect.Effect<Value, unknown, R> {
    const self = this
    return Effect.gen(function* () {
      const callee = yield* self.evaluateExpression(node.callee)
      // Globals are built with this interpreter's R; `instanceof` cannot recover the type argument.
      const construct = callee instanceof Native ? (callee as Native<R>).construct : undefined
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
      const args = yield* self.evaluateCallArguments(node.arguments)
      return yield* self.native(() => construct(args, callee as Native<R>), node)
    })
  }

  private evaluateBinaryExpression(node: BinaryExpression): Effect.Effect<Value, unknown, R> {
    const operator = node.operator
    const left = node.left
    if (left.type === "PrivateIdentifier") throw unsupportedSyntax(left.type, left)
    const self = this
    return Effect.gen(function* () {
      const lhs = yield* self.evaluateExpression(left)
      const rhs = yield* self.evaluateExpression(node.right)
      if (operator === "instanceof") return instanceofValue(lhs, rhs, node)
      return self.applyBinaryOperator(operator, lhs, rhs, node)
    })
  }

  private applyBinaryOperator(operator: string, lhs: Value, rhs: Value, node: AstNode): Value {
    if (operator === "===") return lhs === rhs
    if (operator === "!==") return lhs !== rhs
    if (operator === "in" && rhs instanceof Obj && !containsOpaqueReference(lhs)) {
      return has(rhs, lhs !== null && typeof lhs === "object" ? coerceToString(lhs) : (lhs as PropertyKey))
    }
    if (containsOpaqueReference(lhs) || containsOpaqueReference(rhs)) {
      throw invalidData("Binary operators require data values.", node)
    }
    // Addition and loose equality use the default hint; every other operator asks for a number.
    const hint = operator === "+" || operator === "==" || operator === "!=" ? "default" : "number"
    const coerceOperand = (operand: Value) => (operand instanceof Obj ? operand.toPrimitive(hint) : operand)
    const bothObjects = lhs !== null && typeof lhs === "object" && rhs !== null && typeof rhs === "object"
    const l = coerceOperand(lhs)
    const r = coerceOperand(rhs)
    switch (operator) {
      case "+": {
        const sum = (l as string) + (r as string)
        if (typeof sum === "string") checkStringLength(sum.length)
        return sum
      }
      case "-":
        return (l as number) - (r as number)
      case "*":
        return (l as number) * (r as number)
      case "/":
        return (l as number) / (r as number)
      case "%":
        return (l as number) % (r as number)
      case "**":
        return (l as number) ** (r as number)
      case "==":
        return bothObjects ? lhs === rhs : l == r
      case "!=":
        return bothObjects ? lhs !== rhs : l != r
      case "<":
        return (l as string) < (r as string)
      case "<=":
        return (l as string) <= (r as string)
      case ">":
        return (l as string) > (r as string)
      case ">=":
        return (l as string) >= (r as string)
      case "&":
        return (l as number) & (r as number)
      case "|":
        return (l as number) | (r as number)
      case "^":
        return (l as number) ^ (r as number)
      case "<<":
        return (l as number) << (r as number)
      case ">>":
        return (l as number) >> (r as number)
      case ">>>":
        return (l as number) >>> (r as number)
      case "in":
        if (!(rhs instanceof Obj)) {
          throw typeError("The 'in' operator requires a data object on the right-hand side.", node)
        }
        return has(rhs, coerceOperand(lhs) as PropertyKey)
      default:
        throw typeError(`Unsupported binary operator '${operator}'.`, node)
    }
  }

  private evaluateLogicalExpression(node: LogicalExpression): Effect.Effect<Value, unknown, R> {
    const operator = node.operator
    return Effect.flatMap(this.evaluateExpression(node.left), (left) => {
      if (operator === "&&") return left ? this.evaluateExpression(node.right) : Effect.succeed(left)
      if (operator === "||") return left ? Effect.succeed(left) : this.evaluateExpression(node.right)
      if (operator === "??")
        return left !== null && left !== undefined ? Effect.succeed(left) : this.evaluateExpression(node.right)
      throw typeError(`Unsupported logical operator '${operator}'.`, node)
    })
  }

  private evaluateUnaryExpression(node: UnaryExpression): Effect.Effect<Value, unknown, R> {
    const operator = node.operator
    const argument = node.argument
    if (operator === "delete") return this.evaluateDeleteExpression(argument)
    // Undeclared names short-circuit, but declared TDZ bindings must still throw.
    if (operator === "typeof" && argument.type === "Identifier" && !this.scopes.resolve(argument.name)) {
      return Effect.succeed("undefined")
    }
    return Effect.map(this.evaluateExpression(argument), (value) => {
      if (operator === "typeof") return typeofValue(value)
      if (operator === "!") return !value
      if (operator === "void") return undefined
      if (containsOpaqueReference(value)) {
        throw invalidData("Unary operators require data values.", node)
      }
      const operand = value instanceof Obj ? value.toPrimitive("number") : value
      let result: Value
      switch (operator) {
        case "+":
          result = +(operand as number)
          break
        case "-":
          result = -(operand as number)
          break
        case "~":
          result = ~(operand as number)
          break
        default:
          throw typeError(`Unsupported unary operator '${operator}'.`, node)
      }
      return result
    })
  }

  private evaluateAssignmentExpression(node: AssignmentExpression): Effect.Effect<Value, unknown, R> {
    const left = node.left
    const operator = node.operator
    const self = this
    return Effect.gen(function* () {
      if (operator === "??=" || operator === "||=" || operator === "&&=") {
        return yield* self.evaluateLogicalAssignment(node, left, operator)
      }
      if (operator === "=" && (left.type === "ObjectPattern" || left.type === "ArrayPattern")) {
        const rightValue = yield* self.evaluateExpression(node.right)
        yield* self.assignPattern(left, rightValue, node)
        return rightValue
      }
      if (left.type === "Identifier") {
        const name = left.name
        if (operator !== "=") {
          const current = self.scopes.get(name, left)
          const rightValue = yield* self.evaluateExpression(node.right)
          return self.scopes.set(name, self.applyCompoundAssignment(operator, current, rightValue, node), left)
        }
        const rightValue = yield* self.evaluateNamed(node.right, name)
        return self.scopes.set(name, rightValue, left)
      }
      if (left.type === "MemberExpression") {
        return yield* self.modifyMember(left, (current) =>
          Effect.map(self.evaluateExpression(node.right), (rightValue) => {
            if (operator === "=") return { write: true, next: rightValue, result: rightValue }
            const next = self.applyCompoundAssignment(operator, current, rightValue, node)
            return { write: true, next, result: next }
          }),
        )
      }
      throw typeError("Assignment target must be an Identifier or MemberExpression.", left)
    })
  }

  private evaluateLogicalAssignment(
    node: AssignmentExpression,
    left: Pattern,
    operator: string,
  ): Effect.Effect<Value, unknown, R> {
    const self = this
    const shouldAssign = (current: Value): boolean =>
      operator === "??=" ? current === null || current === undefined : operator === "||=" ? !current : Boolean(current)
    if (left.type === "Identifier") {
      const name = left.name
      return Effect.gen(function* () {
        const current = self.scopes.get(name, left)
        if (!shouldAssign(current)) return current
        const rightValue = yield* self.evaluateNamed(node.right, name)
        return self.scopes.set(name, rightValue, left)
      })
    }
    if (left.type === "MemberExpression") {
      return self.modifyMember(left, (current) =>
        shouldAssign(current)
          ? Effect.map(self.evaluateExpression(node.right), (rightValue) => ({
              write: true,
              next: rightValue,
              result: rightValue,
            }))
          : Effect.succeed({ write: false, next: current, result: current }),
      )
    }
    throw typeError("Assignment target must be an Identifier or MemberExpression.", left)
  }

  private evaluateUpdateExpression(node: UpdateExpression): Effect.Effect<Value, unknown, R> {
    const operator = node.operator
    const argument = node.argument
    const prefix = node.prefix

    const increment = operator === "++" ? 1 : operator === "--" ? -1 : undefined

    if (increment === undefined) {
      throw typeError(`Unsupported update operator '${operator}'.`, node)
    }

    // CodeMode numeric coercion, not host Number(): null-prototype data objects would make
    // the host throw during ToPrimitive, and opaque runtime references must reject clearly.
    const operand = (current: Value): number => {
      if (containsOpaqueReference(current)) {
        throw invalidData(`'${operator}' requires a data value.`, argument)
      }
      return coerceToNumber(current)
    }

    if (argument.type === "Identifier") {
      return Effect.sync(() => {
        const name = argument.name
        const current = operand(this.scopes.get(name, argument))
        const next = current + increment
        this.scopes.set(name, next, argument)
        return prefix ? next : current
      })
    }

    if (argument.type === "MemberExpression") {
      return this.modifyMember(argument, (current) => {
        const value = operand(current)
        const next = value + increment
        return Effect.succeed({ write: true, next, result: prefix ? next : value })
      })
    }

    throw typeError("Update target must be an Identifier or MemberExpression.", argument)
  }

  // EvaluateCall: a member callee supplies its base object as `this`; anything else calls with undefined.
  private evaluateCallExpression(node: CallExpression): Effect.Effect<Value, unknown, R> {
    const callee = node.callee

    const self = this
    return Effect.gen(function* () {
      if (callee.type === "Super") throw unsupportedSyntax(callee.type, callee)
      const { callable, thisValue } =
        callee.type === "MemberExpression"
          ? yield* self.readMethod(callee)
          : { callable: yield* self.evaluateExpression(callee), thisValue: undefined }
      if (callable === OptionalShortCircuit) return OptionalShortCircuit
      if ((callable === null || callable === undefined) && node.optional) return OptionalShortCircuit

      const args = yield* self.evaluateCallArguments(node.arguments)
      return yield* self.call(callable, thisValue, args, node, callee)
    })
  }

  private readMethod(node: MemberExpression): Effect.Effect<{ callable: Value; thisValue: Value }, unknown, R> {
    return Effect.map(this.getMemberReference(node), (reference) => {
      if (reference === OptionalShortCircuit) return { callable: OptionalShortCircuit, thisValue: undefined }
      if (reference instanceof ToolReference) return { callable: reference, thisValue: undefined }
      if ("value" in reference) return { callable: reference.value, thisValue: undefined }
      return { callable: this.readReference(reference, node), thisValue: reference.receiver }
    })
  }

  // The single dispatch for every invocation: call expressions and callbacks share it.
  call(
    callable: Value,
    thisValue: Value,
    args: Array<Value>,
    node?: AstNode,
    callee?: Expression,
  ): Effect.Effect<Value, unknown, R> {
    const self = this
    return Effect.gen(function* () {
      if (callable instanceof ToolReference) {
        if (callable.path.length === 0) {
          throw typeError("The tools root is not callable.", callee ?? node)
        }
        return yield* self.createToolCallPromise(callable.path, args)
      }
      if (callable instanceof Fn) return yield* self.invokeFunction(callable, args, node)
      if (callable instanceof Native) {
        return yield* self.native(() => (callable as Native<R>).call(thisValue, args), node)
      }
      throw typeError(`${calleeDescription(callee) ?? "The called value"} is not a function.`, callee ?? node)
    })
  }

  // Built-ins throw without a location, synchronously or inside their Effect; the call site supplies it.
  private native(body: () => Effect.Effect<Value, unknown, R>, node?: AstNode): Effect.Effect<Value, unknown, R> {
    return Effect.provideService(
      Effect.catchDefect(Effect.suspend(body), (defect) => Effect.die(locate(defect, node))),
      CallSite,
      { node, depth: this.depth },
    )
  }

  private evaluateCallArguments(
    argNodes: ReadonlyArray<Expression | SpreadElement>,
  ): Effect.Effect<Array<Value>, unknown, R> {
    const self = this
    return Effect.gen(function* () {
      const args: Array<Value> = []
      for (const argNode of argNodes) {
        if (argNode.type === "SpreadElement") {
          const spread = yield* self.evaluateExpression(argNode.argument)
          const cursor = yield* self.iterate(spread, argNode)
          if (cursor === undefined) throw typeError("Spread arguments require a synchronous iterable.", argNode)
          while (true) {
            const step = yield* cursor.next
            if (step.done) break
            args.push(step.value)
          }
        } else {
          args.push(yield* self.evaluateExpression(argNode))
        }
      }
      return args
    })
  }

  // A callback invoked by a built-in runs below the call that invoked the built-in, so the deeper of the two counts.
  invokeFunction(fn: Fn, args: Array<Value>, node?: AstNode): Effect.Effect<Value, unknown, R> {
    const self = this
    return Effect.flatMap(CallSite, (site) => {
      const depth = Math.max(self.depth, site.depth) + 1
      if (depth > MAX_CALL_DEPTH) throw rangeError("Maximum call stack size exceeded", node)
      const invocation = new Frame(this.ctx, new ScopeStack([...fn.capturedScopes, new Map()]), depth)
      // Seed all parameters first so defaults cannot fall through to same-named outer bindings.
      const paramScope = invocation.scopes.current()
      for (const parameter of fn.parameters) {
        for (const name of collectPatternNames(parameter)) {
          paramScope.set(name, { mutable: true, value: undefined, initialized: false })
        }
      }
      const bind = Effect.gen(function* () {
        for (const [index, parameter] of fn.parameters.entries()) {
          if (parameter.type === "RestElement") {
            yield* invocation.declarePattern(
              parameter.argument,
              new Arr(self.ctx.builtins.Array, args.slice(index)),
              true,
              parameter,
              true,
            )
            break
          }
          yield* invocation.declarePattern(parameter, args[index], true, parameter, true)
        }
      })
      const body = Effect.gen(function* () {
        if (fn.body.type === "BlockStatement") {
          invocation.scopes.push()
          invocation.hoistVars(fn.body.body, paramScope)
          const result = yield* invocation.evaluateStatement(fn.body)
          return result.kind === "return" ? result.value : undefined
        }

        return yield* invocation.evaluateExpression(fn.body)
      })
      // Generators bind parameters at the call and defer only the body to the first `next()`, as in JS.
      if (fn.generator) return Effect.map(bind, () => this.createGenerator(invocation, body, fn))
      const run = Effect.andThen(bind, body)
      if (!fn.async) return run
      return this.ctx.pending.createWithSelf((self) =>
        Effect.flatMap(run, (value) => resolvePromiseValue(invocation.ctx, value, self)),
      )
    })
  }

  private createGenerator(invocation: Frame<R>, run: Effect.Effect<Value, unknown, R>, fn: Fn): GeneratorObj {
    const asynchronous = fn.async
    const state: GeneratorState = { started: false, completed: false, draining: false, pending: [], pendingIndex: 0 }
    invocation.generatorState = state
    invocation.generatorAsync = asynchronous
    const builtins = this.ctx.builtins
    const result = (value: Value, done: boolean) => record(builtins.Object, { value, done })
    const request = (kind: GeneratorRequestKind, value: Value) => {
      const request = { kind, value, response: Deferred.makeUnsafe<Value, unknown>() }
      if (!asynchronous && state.active) return Effect.die(typeError("Generator is already running."))
      if (asynchronous && (state.completed || (!state.started && kind !== "next"))) {
        state.started = true
        state.completed = true
        state.pending.push(request)
        if (state.draining) return Deferred.await(request.response)
        state.draining = true
        return Effect.andThen(
          this.ctx.pending.fork(
            invocation
              .completeGeneratorRequests(state, true)
              .pipe(Effect.ensuring(Effect.sync(() => (state.draining = false)))),
          ),
          Deferred.await(request.response),
        )
      }
      if (state.completed) {
        if (kind === "throw") return Effect.fail(new Throw(value))
        return Effect.succeed(result(kind === "return" ? value : undefined, true))
      }
      if (!state.started && kind !== "next") {
        state.completed = true
        if (kind === "throw") return Effect.fail(new Throw(value))
        return Effect.succeed(result(value, true))
      }

      state.pending.push(request)
      if (state.available) {
        const available = state.available
        state.available = undefined
        Deferred.doneUnsafe(available, Exit.succeed(undefined))
      }
      if (!state.started) {
        state.started = true
        const body = Effect.gen(function* () {
          state.active = yield* invocation.takeGeneratorRequest(state)
          const exit = yield* Effect.exit(
            run.pipe(
              Effect.flatMap((result) => (asynchronous ? invocation.awaitValue(result) : Effect.succeed(result))),
              Effect.catch((error) =>
                error instanceof GeneratorReturn
                  ? asynchronous
                    ? invocation.awaitValue(error.value)
                    : Effect.succeed(error.value)
                  : Effect.fail(error),
              ),
            ),
          )
          const active = state.active
          state.active = undefined
          if (active) {
            Deferred.doneUnsafe(active.response, Exit.isSuccess(exit) ? Exit.succeed(result(exit.value, true)) : exit)
          }
          yield* invocation.completeGeneratorRequests(state, asynchronous)
          state.completed = true
        })
        return Effect.andThen(this.ctx.pending.fork(body), Deferred.await(request.response))
      }
      return Deferred.await(request.response)
    }
    const proto = get(fn, "prototype")
    return new GeneratorObj(proto instanceof Obj ? proto : builtins.Generator, asynchronous, request)
  }

  private completeGeneratorRequests(state: GeneratorState, asynchronous: boolean): Effect.Effect<void, never, R> {
    const self = this
    const result = (value: Value, done: boolean) => record(self.ctx.builtins.Object, { value, done })
    return Effect.gen(function* () {
      while (true) {
        const pending = self.dequeueGeneratorRequest(state)
        if (!pending) return
        if (pending.kind === "throw") {
          Deferred.doneUnsafe(pending.response, Exit.fail(new Throw(pending.value)))
          continue
        }
        if (asynchronous && pending.kind === "return") {
          const resolved = yield* Effect.exit(self.awaitValue(pending.value))
          Deferred.doneUnsafe(
            pending.response,
            Exit.isSuccess(resolved) ? Exit.succeed(result(resolved.value, true)) : resolved,
          )
          continue
        }
        Deferred.doneUnsafe(
          pending.response,
          Exit.succeed(result(pending.kind === "return" ? pending.value : undefined, true)),
        )
      }
    })
  }

  private takeGeneratorRequest(state: GeneratorState): Effect.Effect<GeneratorRequest> {
    const next = this.dequeueGeneratorRequest(state)
    if (next) return Effect.succeed(next)
    state.available = Deferred.makeUnsafe<void>()
    return Effect.andThen(
      Deferred.await(state.available),
      Effect.sync(() => this.dequeueGeneratorRequest(state)!),
    )
  }

  private dequeueGeneratorRequest(state: GeneratorState): GeneratorRequest | undefined {
    const request = state.pending[state.pendingIndex]
    if (!request) return undefined
    state.pendingIndex += 1
    if (state.pendingIndex === state.pending.length) {
      state.pending = []
      state.pendingIndex = 0
    }
    return request
  }

  private evaluateYieldExpression(node: YieldExpression): Effect.Effect<Value, unknown, R> {
    const argument = node.argument
    const self = this
    return Effect.gen(function* () {
      if (!self.generatorState) throw typeError("yield is only valid inside a generator.", node)
      if (node.delegate) {
        const value = argument ? yield* self.evaluateExpression(argument) : undefined
        return yield* self.delegateYield(value, node)
      }
      const value = argument ? yield* self.evaluateExpression(argument) : undefined
      const yielded = self.generatorAsync ? yield* self.awaitValue(value) : value
      return yield* self.suspendGenerator(yielded, node)
    })
  }

  private suspendGenerator(value: Value, node: AstNode): Effect.Effect<Value, unknown, R> {
    const state = this.generatorState
    if (!state?.active) throw typeError("Generator has no active request.", node)
    Deferred.doneUnsafe(state.active.response, Exit.succeed(record(this.ctx.builtins.Object, { value, done: false })))
    state.active = undefined
    return Effect.flatMap(this.takeGeneratorRequest(state), (request) => {
      state.active = request
      if (request.kind === "next") return Effect.succeed(request.value)
      if (request.kind === "throw") return Effect.fail(new Throw(request.value))
      return this.generatorAsync
        ? Effect.flatMap(this.awaitValue(request.value), (value) => Effect.fail(new GeneratorReturn(value)))
        : Effect.fail(new GeneratorReturn(request.value))
    })
  }

  private delegateYield(value: Value, node: AstNode): Effect.Effect<Value, unknown, R> {
    const self = this
    return Effect.gen(function* () {
      const cursor = self.builtinCursor(value)
      if (cursor !== undefined) {
        while (true) {
          const step = yield* cursor.next
          if (step.done) return undefined
          const resumed = yield* Effect.exit(
            self.suspendGenerator(self.generatorAsync ? yield* self.awaitValue(step.value) : step.value, node),
          )
          if (Exit.isSuccess(resumed)) continue
          const error = Cause.squash(resumed.cause)
          if (error instanceof GeneratorReturn) {
            yield* cursor.close
            return yield* Effect.fail(error)
          }
          if (error instanceof Throw) {
            yield* cursor.close
            throw typeError("The delegated iterator does not provide a throw() method.", node)
          }
          return yield* Effect.failCause(resumed.cause)
        }
      }

      const iterator = yield* self.customIterator(value, node, self.generatorAsync)
      if (!iterator) throw typeError("yield* requires a compatible iterable value.", node)
      let kind: GeneratorRequestKind = "next"
      let input: Value = undefined
      while (true) {
        const method = kind === "next" ? iterator.next : get(iterator.iterator, kind)
        if (method === undefined || method === null) {
          if (kind === "return") return yield* Effect.fail(new GeneratorReturn(input))
          yield* self.closeIterator(iterator, node, self.generatorAsync)
          throw typeError("The delegated iterator does not provide a throw() method.", node)
        }
        const called = yield* self.call(
          self.requireIteratorMethod(method, `Iterator ${kind}`, node),
          iterator.iterator,
          [input],
          node,
        )
        const result = self.requireIteratorObject(
          iterator.asynchronous ? yield* self.awaitValue(called) : called,
          `Iterator ${kind}() result`,
          node,
        )
        const done = Boolean(get(result, "done"))
        const resultValue: Value =
          self.generatorAsync && !iterator.asynchronous
            ? yield* self.awaitAsyncFromSyncValue(iterator, get(result, "value"), node, kind !== "return" && !done)
            : get(result, "value")
        if (done) {
          if (kind === "return") return yield* Effect.fail(new GeneratorReturn(resultValue))
          return resultValue
        }

        const resumed: Exit.Exit<Value, unknown> = yield* Effect.exit(self.suspendGenerator(resultValue, node))
        if (Exit.isSuccess(resumed)) {
          kind = "next"
          input = resumed.value
          continue
        }
        const error: unknown = Cause.squash(resumed.cause)
        if (!(error instanceof GeneratorReturn) && !(error instanceof Throw)) {
          return yield* Effect.failCause(resumed.cause)
        }
        kind = error instanceof GeneratorReturn ? "return" : "throw"
        input = error.value
      }
    })
  }

  private evaluateObjectExpression(node: ObjectExpression): Effect.Effect<Obj, unknown, R> {
    const objectValue = new Obj(this.ctx.builtins.Object)
    const self = this
    return Effect.gen(function* () {
      for (const property of node.properties) {
        if (property.type === "SpreadElement") {
          const spread = yield* self.evaluateExpression(property.argument)
          if (spread === null || spread === undefined) continue
          assign(objectValue, enumerableSource(self.ctx, "Object spread", spread, property))
          continue
        }

        if (property.kind !== "init") {
          throw typeError("Only init object properties are supported.", property)
        }

        const keyNode = property.key

        let key: PropertyKey

        if (property.computed) {
          key = self.toPropertyKey(yield* self.evaluateExpression(keyNode))
        } else if (keyNode.type === "Identifier") {
          key = keyNode.name
        } else if (keyNode.type === "Literal") {
          key = self.toPropertyKey(literal(keyNode))
        } else {
          throw typeError("Unsupported object property key shape.", keyNode)
        }

        const name =
          key === IteratorSymbol
            ? "[Symbol.iterator]"
            : key === AsyncIteratorSymbol
              ? "[Symbol.asyncIterator]"
              : String(key)
        define(objectValue, key, yield* self.evaluateNamed(property.value, name))
      }

      return objectValue
    })
  }

  private evaluateArrayExpression(node: ArrayExpression): Effect.Effect<Arr, unknown, R> {
    const values: Array<Value> = []

    const self = this
    return Effect.gen(function* () {
      for (const element of node.elements) {
        if (element === null) {
          // A literal elision is a real hole, like JS: extend length without an own index.
          values.length += 1
          continue
        }
        if (element.type === "SpreadElement") {
          const spread = yield* self.evaluateExpression(element.argument)
          const cursor = yield* self.iterate(spread, element)
          if (cursor === undefined) throw typeError("Array spread requires a synchronous iterable.", element)
          while (true) {
            const step = yield* cursor.next
            if (step.done) break
            values.push(step.value)
          }
        } else {
          values.push(yield* self.evaluateExpression(element))
        }
      }
      return new Arr(self.ctx.builtins.Array, values)
    })
  }

  private evaluateTemplateLiteral(node: TemplateLiteral): Effect.Effect<string, unknown, R> {
    const quasis = node.quasis
    const expressions = node.expressions

    let output = ""

    const self = this
    return Effect.gen(function* () {
      for (let index = 0; index < quasis.length; index += 1) {
        const quasi = quasis[index]!
        // acorn only omits `cooked` for invalid escapes, which are a parse error outside a tagged template.
        if (typeof quasi.value.cooked !== "string") {
          throw typeError("Invalid template literal quasi.", quasi)
        }
        output += quasi.value.cooked
        checkStringLength(output.length)

        if (index < expressions.length) {
          const raw = yield* self.evaluateExpression(expressions[index])
          output += coerceToString(raw)
          checkStringLength(output.length)
        }
      }

      return output
    })
  }

  // `tag\`a${x}b\`` is `tag(strings, x)`: the tag is read like a callee (a member keeps its receiver), the
  // substitutions are evaluated in order, and `strings` carries the escaped source as `strings.raw`.
  private evaluateTaggedTemplate(node: TaggedTemplateExpression): Effect.Effect<Value, unknown, R> {
    const self = this
    return Effect.gen(function* () {
      const { callable, thisValue } =
        node.tag.type === "MemberExpression"
          ? yield* self.readMethod(node.tag)
          : { callable: yield* self.evaluateExpression(node.tag), thisValue: undefined }
      const strings = self.ctx.templates.get(node) ?? self.createTemplateObject(node)
      const values = yield* Effect.forEach(node.quasi.expressions, (expression) => self.evaluateExpression(expression))
      return yield* self.call(callable, thisValue, [strings, ...values], node, node.tag)
    })
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

  private evaluateConditionalExpression(node: ConditionalExpression): Effect.Effect<Value, unknown, R> {
    return Effect.flatMap(this.evaluateExpression(node.test), (test) =>
      this.evaluateExpression(test ? node.consequent : node.alternate),
    )
  }

  private applyCompoundAssignment(operator: string, current: Value, incoming: Value, node: AstNode): Value {
    if (!compoundOperators.has(operator)) {
      throw typeError(`Unsupported assignment operator '${operator}'.`, node)
    }
    return this.applyBinaryOperator(operator.slice(0, -1), current, incoming, node)
  }

  private getMemberReference(
    node: MemberExpression,
  ): Effect.Effect<MemberReference | ToolReference | { value: Value } | typeof OptionalShortCircuit, unknown, R> {
    const objectNode = node.object
    const propertyNode = node.property
    if (objectNode.type === "Super") throw unsupportedSyntax(objectNode.type, objectNode)
    if (propertyNode.type === "PrivateIdentifier") throw unsupportedSyntax(propertyNode.type, propertyNode)
    const self = this
    return Effect.gen(function* () {
      const objectValue = yield* self.evaluateExpression(objectNode)
      if (objectValue === OptionalShortCircuit) return OptionalShortCircuit
      if ((objectValue === null || objectValue === undefined) && node.optional) return OptionalShortCircuit

      const key = node.computed
        ? self.toPropertyKey(yield* self.evaluateExpression(propertyNode))
        : propertyNode.type === "Identifier"
          ? propertyNode.name
          : self.toPropertyKey(yield* self.evaluateExpression(propertyNode))

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
      const proto = primitivePrototype(self.ctx.builtins, objectValue)
      if (proto !== undefined) return { target: proto, key, receiver: objectValue }

      if (objectValue === null || objectValue === undefined) {
        throw typeError(`Cannot read properties of ${objectValue} (reading '${String(key)}').`, objectNode)
      }
      throw typeError("Cannot access a property on a non-object value.", objectNode)
    })
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

  private readMember(node: MemberExpression): Effect.Effect<Value, unknown, R> {
    return Effect.map(this.getMemberReference(node), (reference) => {
      if (reference === OptionalShortCircuit) return OptionalShortCircuit
      if (reference instanceof ToolReference) return reference
      if ("value" in reference) return reference.value
      return this.readReference(reference, node)
    })
  }

  private writeMember(node: MemberExpression, value: Value): Effect.Effect<Value, unknown, R> {
    return this.modifyMember(node, () => Effect.succeed({ write: true, next: value, result: value }))
  }

  private evaluateDeleteExpression(argument: Expression): Effect.Effect<boolean, unknown, R> {
    const target = argument.type === "ChainExpression" ? argument.expression : argument
    if (target.type === "Identifier") throw typeError("Only data fields may be deleted.", argument)
    // `delete <non-reference>` evaluates the operand and is true, as in JS.
    if (target.type !== "MemberExpression") return Effect.map(this.evaluateExpression(target), () => true)
    return Effect.map(this.getMemberReference(target), (reference) => {
      if (reference === OptionalShortCircuit) return true
      if (reference instanceof ToolReference || "value" in reference || reference.receiver !== reference.target) {
        throw invalidData("Only data fields may be deleted.", target)
      }
      if (remove(reference.target, reference.key)) return true
      throw typeError(`Cannot delete property '${String(reference.key)}'.`, target)
    })
  }

  // Resolve side-effecting object and key expressions exactly once.
  private modifyMember(
    node: MemberExpression,
    compute: (current: Value) => Effect.Effect<{ write: boolean; next: Value; result: Value }, unknown, R>,
  ): Effect.Effect<Value, unknown, R> {
    const self = this
    return Effect.gen(function* () {
      const reference = yield* self.getMemberReference(node)
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
      const { write, next, result } = yield* compute(self.readReference(reference, node))
      if (write) self.assignToReference(reference.target, key, next, node)
      return result
    })
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
    if (target instanceof Arr && key === "length") throw rangeError("Invalid array length", node)
    throw typeError(`Cannot assign to read only property '${String(key)}'.`, node)
  }

  // ToPropertyKey: anything else becomes its string form, so `counts[row.category]` works when the field is null.
  private toPropertyKey(value: Value): PropertyKey {
    if (typeof value === "string" || typeof value === "number" || typeof value === "symbol") return value
    return coerceToString(value)
  }
}
