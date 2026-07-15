import { Cause, Effect } from "effect"
import { isBlockedMember, ToolReference, ToolRuntimeError, type SafeObject } from "../tool-runtime.js"
import {
  type AstNode,
  asNode,
  type Binding,
  CodeModeFunction,
  CoercionFunction,
  ComputedValue,
  ErrorConstructorReference,
  GlobalMethodReference,
  GlobalNamespace,
  getArray,
  getBoolean,
  getNode,
  getOptionalNode,
  getString,
  IntrinsicReference,
  InterpreterRuntimeError,
  isRecord,
  type MemberReference,
  OptionalShortCircuit,
  PromiseCapabilityFunction,
  PromiseInstanceMethodReference,
  PromiseMethodReference,
  type PromiseMethodName,
  PromiseNamespace,
  ProgramThrow,
  type ProgramNode,
  SearchFunction,
  type StatementResult,
  supportedSyntaxMessage,
  unsupportedSyntax,
  UriFunction,
} from "./model.js"
import { caughtErrorValue, constructErrorValue } from "./errors.js"
import { type CallbackRunner, invokeArrayFrom, invokeGlobalMethod, invokeIntrinsic } from "./methods.js"
import {
  constructPromise,
  invokePromiseInstanceMethod,
  invokePromiseMethod,
  PromiseRuntime,
  selfResolutionError,
} from "./promises.js"
import { containsOpaqueReference, isRuntimeReference, rejectCircularInsertion, typeofValue } from "./references.js"
import { ScopeStack } from "./scope.js"
import { arrayMethods, mapMethods, setMethods, spreadItems } from "../stdlib/collections.js"
import { consoleMethods, formatConsoleMessage } from "../stdlib/console.js"
import { dateMethods } from "../stdlib/date.js"
import { mathConstants } from "../stdlib/math.js"
import { numberConstants, numberMethods, numberStatics } from "../stdlib/number.js"
import { objectMethodsPreservingIdentity } from "../stdlib/object.js"
import { promiseStatics } from "../stdlib/promise.js"
import { escapeRegexHint, regexpMethods, regexpProperties, regexFailureReason } from "../stdlib/regexp.js"
import { stringMethods, stringStatics } from "../stdlib/string.js"
import {
  urlMethods,
  urlProperties,
  urlSearchParamsMethods,
  urlWritableProperties,
  invokeUriFunction,
  uriArgument,
  urlArgument,
} from "../stdlib/url.js"
import {
  boundedData,
  coerceToNumber,
  coerceToString,
  compoundOperators,
  errorBrandName,
  errorConstructors,
  invokeCoercion,
  valueConstructors,
} from "../stdlib/value.js"
import {
  isCodeModeValue,
  CodeModeDate,
  CodeModeMap,
  CodeModePromise,
  CodeModeRegExp,
  CodeModeSet,
  CodeModeURL,
  CodeModeURLSearchParams,
} from "../values.js"

const instanceofValue = (lhs: unknown, rhs: unknown, node: AstNode): boolean => {
  if (rhs instanceof ErrorConstructorReference) {
    const brand = errorBrandName(lhs)
    return brand !== undefined && (rhs.name === "Error" || brand === rhs.name)
  }
  if (rhs instanceof GlobalNamespace) {
    switch (rhs.name) {
      case "Date":
        return lhs instanceof CodeModeDate
      case "RegExp":
        return lhs instanceof CodeModeRegExp
      case "Map":
        return lhs instanceof CodeModeMap
      case "Set":
        return lhs instanceof CodeModeSet
      case "URL":
        return lhs instanceof CodeModeURL
      case "URLSearchParams":
        return lhs instanceof CodeModeURLSearchParams
      case "Array":
        return Array.isArray(lhs)
      case "Object":
        return lhs !== null && (typeof lhs === "object" || typeofValue(lhs) === "function")
    }
  }
  if (rhs instanceof PromiseNamespace) return lhs instanceof CodeModePromise
  if (rhs instanceof CoercionFunction && (rhs.name === "Number" || rhs.name === "String" || rhs.name === "Boolean")) {
    return false
  }
  throw new InterpreterRuntimeError(
    "The right-hand side of 'instanceof' must be a constructor CodeMode knows: Error (or a specific error type like TypeError), Date, RegExp, Map, Set, URL, URLSearchParams, Array, Object, or Promise.",
    node,
  )
}

const collectPatternNames = (pattern: AstNode, out: Array<string> = []): Array<string> => {
  switch (pattern.type) {
    case "Identifier":
      out.push(getString(pattern, "name"))
      break
    case "AssignmentPattern":
      collectPatternNames(getNode(pattern, "left"), out)
      break
    case "RestElement":
      collectPatternNames(getNode(pattern, "argument"), out)
      break
    case "ArrayPattern":
      for (const element of getArray(pattern, "elements")) {
        if (element !== null) collectPatternNames(asNode(element, "elements"), out)
      }
      break
    case "ObjectPattern":
      for (const property of getArray(pattern, "properties")) {
        const prop = asNode(property, "properties")
        collectPatternNames(prop.type === "RestElement" ? getNode(prop, "argument") : getNode(prop, "value"), out)
      }
      break
  }
  return out
}

export class Interpreter<R> {
  private scopes: ScopeStack
  private readonly invokeTool: (path: ReadonlyArray<string>, args: Array<unknown>) => Effect.Effect<unknown, unknown, R>
  private readonly invokeSearch: (args: Array<unknown>) => Effect.Effect<unknown, unknown, R>
  private readonly toolKeys: (path: ReadonlyArray<string>) => ReadonlyArray<string>
  private readonly logs: Array<string>
  private readonly promises: PromiseRuntime<R>
  private readonly runner: CallbackRunner<R> = {
    invokeFunction: (fn, args) => this.invokeFunction(fn, args),
    invokeCallable: (callable, args, node) => this.invokeCallable(callable, args, node),
    settlePromise: (promise) => this.settlePromise(promise),
  }

  constructor(
    invokeTool: (path: ReadonlyArray<string>, args: Array<unknown>) => Effect.Effect<unknown, unknown, R>,
    invokeSearch: (args: Array<unknown>) => Effect.Effect<unknown, unknown, R>,
    toolKeys: (path: ReadonlyArray<string>) => ReadonlyArray<string>,
    promises: PromiseRuntime<R>,
    logs: Array<string> = [],
  ) {
    const globalScope = new Map<string, Binding>()
    this.scopes = new ScopeStack([globalScope])
    this.invokeTool = invokeTool
    this.invokeSearch = invokeSearch
    this.toolKeys = toolKeys
    this.logs = logs
    this.promises = promises
    globalScope.set("tools", { mutable: false, value: new ToolReference([]) })
    globalScope.set("search", { mutable: false, value: new SearchFunction() })
    globalScope.set("Promise", { mutable: false, value: new PromiseNamespace() })
    globalScope.set("undefined", { mutable: false, value: undefined })
    globalScope.set("Object", { mutable: false, value: new GlobalNamespace("Object") })
    globalScope.set("Math", { mutable: false, value: new GlobalNamespace("Math") })
    globalScope.set("JSON", { mutable: false, value: new GlobalNamespace("JSON") })
    globalScope.set("Number", { mutable: false, value: new CoercionFunction("Number") })
    globalScope.set("String", { mutable: false, value: new CoercionFunction("String") })
    globalScope.set("Boolean", { mutable: false, value: new CoercionFunction("Boolean") })
    globalScope.set("Array", { mutable: false, value: new GlobalNamespace("Array") })
    globalScope.set("console", { mutable: false, value: new GlobalNamespace("console") })
    globalScope.set("parseInt", { mutable: false, value: new CoercionFunction("parseInt") })
    globalScope.set("parseFloat", { mutable: false, value: new CoercionFunction("parseFloat") })
    globalScope.set("Date", { mutable: false, value: new GlobalNamespace("Date") })
    globalScope.set("RegExp", { mutable: false, value: new GlobalNamespace("RegExp") })
    globalScope.set("Map", { mutable: false, value: new GlobalNamespace("Map") })
    globalScope.set("Set", { mutable: false, value: new GlobalNamespace("Set") })
    globalScope.set("URL", { mutable: false, value: new GlobalNamespace("URL") })
    globalScope.set("URLSearchParams", { mutable: false, value: new GlobalNamespace("URLSearchParams") })
    globalScope.set("encodeURI", { mutable: false, value: new UriFunction("encodeURI") })
    globalScope.set("encodeURIComponent", { mutable: false, value: new UriFunction("encodeURIComponent") })
    globalScope.set("decodeURI", { mutable: false, value: new UriFunction("decodeURI") })
    globalScope.set("decodeURIComponent", { mutable: false, value: new UriFunction("decodeURIComponent") })
    for (const name of errorConstructors) {
      globalScope.set(name, { mutable: false, value: new ErrorConstructorReference(name) })
    }
    globalScope.set("NaN", { mutable: false, value: NaN })
    globalScope.set("Infinity", { mutable: false, value: Infinity })
  }

  run(program: ProgramNode): Effect.Effect<unknown, unknown, R> {
    const self = this
    // Keep top-level declarations separate so they can shadow builtins.
    this.scopes.push()
    return Effect.gen(function* () {
      self.hoistFunctions(program.body)
      let value: unknown = undefined
      for (const [index, statement] of program.body.entries()) {
        if (index === program.body.length - 1 && statement.type === "ExpressionStatement") {
          value = yield* self.evaluateExpression(getNode(statement, "expression"))
          break
        }
        const result = yield* self.evaluateStatement(statement)

        if (result.kind === "return") {
          value = result.value
          break
        }

        if (result.kind === "break" || result.kind === "continue") {
          throw new InterpreterRuntimeError(`Unexpected '${result.kind}' outside of a loop.`, statement)
        }
      }

      // The implicit async body adopts returned promises before copy-out.
      if (value instanceof CodeModePromise) value = yield* self.settlePromise(value)
      return value
    }).pipe(Effect.ensuring(Effect.sync(() => self.scopes.pop())))
  }

  // Fork at the call site so admission and hooks occur when the call is made.
  private createToolCallPromise(
    path: ReadonlyArray<string>,
    args: Array<unknown>,
  ): Effect.Effect<CodeModePromise, never, R> {
    return this.createPromise(Effect.suspend(() => this.invokeTool(path, args)))
  }

  private createPromise(effect: Effect.Effect<unknown, unknown, R>): Effect.Effect<CodeModePromise, never, R> {
    return this.promises.create(effect)
  }

  // Fiber exits make settlement idempotent; yielding prevents inline continuation.
  private settlePromise(promise: CodeModePromise): Effect.Effect<unknown, unknown, never> {
    const promises = this.promises
    return Effect.suspend(() => {
      promises.markObserved(promise)
      return Effect.flatMap(promises.await(promise), (exit) => Effect.andThen(Effect.yieldNow, exit))
    })
  }

  private evaluateStatement(node: AstNode): Effect.Effect<StatementResult, unknown, R> {
    switch (node.type) {
      case "ExpressionStatement":
        return Effect.as(this.evaluateExpression(getNode(node, "expression")), { kind: "none" })
      case "VariableDeclaration":
        return Effect.map(this.evaluateVariableDeclaration(node), () => ({ kind: "none" }))
      case "ReturnStatement": {
        const argumentNode = getOptionalNode(node, "argument")
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

  private evaluateBlock(node: AstNode): Effect.Effect<StatementResult, unknown, R> {
    this.scopes.push()
    const self = this
    return Effect.gen(function* () {
      const body = getArray(node, "body")
      self.hoistFunctions(body)

      for (const statementValue of body) {
        const statement = asNode(statementValue, "body")
        const result = yield* self.evaluateStatement(statement)

        if (result.kind !== "none") {
          return result
        }
      }

      return { kind: "none" } satisfies StatementResult
    }).pipe(Effect.ensuring(Effect.sync(() => self.scopes.pop())))
  }

  private createFunction(node: AstNode): CodeModeFunction {
    if (node.generator === true) {
      throw new InterpreterRuntimeError(
        "Generator functions are not supported in CodeMode.",
        node,
        "UnsupportedSyntax",
        [supportedSyntaxMessage],
      )
    }
    return new CodeModeFunction(
      getArray(node, "params").map((parameter, index) => asNode(parameter, `params[${index}]`)),
      getNode(node, "body"),
      this.scopes.capture(),
      node.async === true,
    )
  }

  private hoistFunctions(statements: Array<unknown>): void {
    for (const statementValue of statements) {
      if (!isRecord(statementValue) || statementValue.type !== "FunctionDeclaration") continue
      const node = statementValue as AstNode
      this.scopes.declare(getString(getNode(node, "id"), "name"), this.createFunction(node), true, node)
    }
  }

  private evaluateIfStatement(node: AstNode): Effect.Effect<StatementResult, unknown, R> {
    const testNode = getNode(node, "test")
    const consequentNode = getNode(node, "consequent")
    const alternateNode = getOptionalNode(node, "alternate")

    return Effect.flatMap(this.evaluateExpression(testNode), (test) =>
      test
        ? this.evaluateStatement(consequentNode)
        : alternateNode
          ? this.evaluateStatement(alternateNode)
          : Effect.succeed({ kind: "none" }),
    )
  }

  private evaluateSwitchStatement(node: AstNode): Effect.Effect<StatementResult, unknown, R> {
    const self = this
    this.scopes.push()
    return Effect.gen(function* () {
      const discriminant = yield* self.evaluateExpression(getNode(node, "discriminant"))
      if (containsOpaqueReference(discriminant)) {
        throw new InterpreterRuntimeError(
          "Switch discriminants must be data values in CodeMode.",
          node,
          "InvalidDataValue",
        )
      }
      const cases = getArray(node, "cases").map((value, index) => asNode(value, `cases[${index}]`))
      let defaultIndex: number | undefined
      let selected: number | undefined
      for (const [index, branch] of cases.entries()) {
        const test = getOptionalNode(branch, "test")
        if (!test) {
          defaultIndex = index
          continue
        }
        const candidate = yield* self.evaluateExpression(test)
        if (containsOpaqueReference(candidate)) {
          throw new InterpreterRuntimeError(
            "Switch case values must be data values in CodeMode.",
            test,
            "InvalidDataValue",
          )
        }
        if (candidate === discriminant) {
          selected = index
          break
        }
      }
      const start = selected ?? defaultIndex
      if (start === undefined) return { kind: "none" } satisfies StatementResult
      for (let index = start; index < cases.length; index += 1) {
        for (const statementValue of getArray(cases[index]!, "consequent")) {
          const result = yield* self.evaluateStatement(asNode(statementValue, "consequent"))
          if (result.kind === "break") return { kind: "none" } satisfies StatementResult
          if (result.kind === "return" || result.kind === "continue") return result
        }
      }
      return { kind: "none" } satisfies StatementResult
    }).pipe(Effect.ensuring(Effect.sync(() => self.scopes.pop())))
  }

  private evaluateWhileStatement(node: AstNode): Effect.Effect<StatementResult, unknown, R> {
    const testNode = getNode(node, "test")
    const bodyNode = getNode(node, "body")

    const self = this
    return Effect.gen(function* () {
      while (yield* self.evaluateExpression(testNode)) {
        const result = yield* self.evaluateStatement(bodyNode)

        if (result.kind === "continue") {
          continue
        }

        if (result.kind === "break") {
          return { kind: "none" } satisfies StatementResult
        }

        if (result.kind === "return") {
          return result
        }
      }

      return { kind: "none" } satisfies StatementResult
    })
  }

  private evaluateDoWhileStatement(node: AstNode): Effect.Effect<StatementResult, unknown, R> {
    const bodyNode = getNode(node, "body")
    const testNode = getNode(node, "test")

    const self = this
    return Effect.gen(function* () {
      do {
        const result = yield* self.evaluateStatement(bodyNode)

        if (result.kind === "continue") {
          continue
        }

        if (result.kind === "break") {
          return { kind: "none" } satisfies StatementResult
        }

        if (result.kind === "return") {
          return result
        }
      } while (yield* self.evaluateExpression(testNode))

      return { kind: "none" } satisfies StatementResult
    })
  }

  private evaluateForStatement(node: AstNode): Effect.Effect<StatementResult, unknown, R> {
    this.scopes.push()
    const self = this
    return Effect.gen(function* () {
      const initNode = getOptionalNode(node, "init")
      const testNode = getOptionalNode(node, "test")
      const updateNode = getOptionalNode(node, "update")
      const bodyNode = getNode(node, "body")

      if (initNode) {
        if (initNode.type === "VariableDeclaration") {
          yield* self.evaluateVariableDeclaration(initNode)
        } else {
          yield* self.evaluateExpression(initNode)
        }
      }

      const perIterationBindings =
        initNode?.type === "VariableDeclaration" && getString(initNode, "kind") !== "var"
          ? Array.from(self.scopes.current().keys())
          : []

      while (testNode ? yield* self.evaluateExpression(testNode) : true) {
        const iterationScope =
          perIterationBindings.length > 0
            ? new Map(
                perIterationBindings.map((name): [string, Binding] => [name, { ...self.scopes.current().get(name)! }]),
              )
            : undefined
        if (iterationScope) self.scopes.push(iterationScope)
        const result = yield* self.evaluateStatement(bodyNode).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              if (iterationScope) self.scopes.pop()
            }),
          ),
        )

        if (result.kind === "return") {
          return result
        }

        if (result.kind === "break") {
          return { kind: "none" } satisfies StatementResult
        }

        if (iterationScope) {
          const loopScope = self.scopes.current()
          for (const name of perIterationBindings) {
            loopScope.set(name, { ...iterationScope.get(name)! })
          }
        }

        if (updateNode) {
          yield* self.evaluateExpression(updateNode)
        }

        if (result.kind === "continue") {
          continue
        }
      }

      return { kind: "none" } satisfies StatementResult
    }).pipe(Effect.ensuring(Effect.sync(() => self.scopes.pop())))
  }

  private evaluateForOfStatement(node: AstNode): Effect.Effect<StatementResult, unknown, R> {
    if (getBoolean(node, "await")) {
      throw new InterpreterRuntimeError("for await...of is not supported.", node)
    }

    const self = this
    return Effect.gen(function* () {
      const left = getNode(node, "left")
      const right = yield* self.evaluateExpression(getNode(node, "right"))
      const body = getNode(node, "body")

      const iterable = spreadItems(right)
      if (iterable === undefined) {
        throw new InterpreterRuntimeError("for...of requires an array, string, Map, or Set value in CodeMode.", node)
      }

      let declaration: { readonly pattern: AstNode; readonly mutable: boolean } | undefined
      let assignment: AstNode | undefined

      if (left.type === "VariableDeclaration") {
        const declarations = getArray(left, "declarations")
        if (declarations.length !== 1) {
          throw new InterpreterRuntimeError("for...of supports one declared binding.", left)
        }

        const declarator = asNode(declarations[0], "declarations[0]")
        declaration = { pattern: getNode(declarator, "id"), mutable: getString(left, "kind") !== "const" }
      } else if (
        left.type === "Identifier" ||
        left.type === "MemberExpression" ||
        left.type === "ArrayPattern" ||
        left.type === "ObjectPattern"
      ) {
        assignment = left
      } else {
        throw new InterpreterRuntimeError("Unsupported for...of binding.", left)
      }

      for (const value of iterable) {
        if (declaration) {
          self.scopes.push()
          yield* self.declarePattern(declaration.pattern, value, declaration.mutable, left)
        } else if (assignment) {
          yield* self.assignPattern(assignment, value, left)
        }

        const result = yield* self.evaluateStatement(body).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              if (declaration) self.scopes.pop()
            }),
          ),
        )

        if (result.kind === "return") {
          return result
        }

        if (result.kind === "break") {
          return { kind: "none" }
        }

        if (result.kind === "continue") {
          continue
        }
      }

      return { kind: "none" }
    })
  }

  private enumerableKeys(value: unknown): Array<string> | undefined {
    if (value instanceof ToolReference) {
      return [...this.toolKeys(value.path)]
    }
    if (Array.isArray(value)) {
      return Object.keys(value)
    }
    if (value !== null && typeof value === "object" && !isRuntimeReference(value)) {
      return Object.keys(value)
    }
    return undefined
  }

  private evaluateForInStatement(node: AstNode): Effect.Effect<StatementResult, unknown, R> {
    const self = this
    return Effect.gen(function* () {
      const left = getNode(node, "left")
      const right = yield* self.evaluateExpression(getNode(node, "right"))
      const body = getNode(node, "body")

      const keys = self.enumerableKeys(right)
      if (keys === undefined) {
        throw new InterpreterRuntimeError(
          "for...in requires a plain object, array, or tools reference in CodeMode. Use for...of for arrays/strings/Maps/Sets, or Object.keys(value) for a key list.",
          node,
        )
      }

      let declaration: { readonly pattern: AstNode; readonly mutable: boolean } | undefined
      let assignmentName: string | undefined

      if (left.type === "VariableDeclaration") {
        const declarations = getArray(left, "declarations")
        if (declarations.length !== 1) {
          throw new InterpreterRuntimeError("for...in supports one declared binding.", left)
        }

        const declarator = asNode(declarations[0], "declarations[0]")
        declaration = { pattern: getNode(declarator, "id"), mutable: getString(left, "kind") !== "const" }
      } else if (left.type === "Identifier") {
        assignmentName = getString(left, "name")
      } else {
        throw new InterpreterRuntimeError("Unsupported for...in binding.", left)
      }

      for (const key of keys) {
        if (declaration) {
          self.scopes.push()
          yield* self.declarePattern(declaration.pattern, key, declaration.mutable, left)
        } else if (assignmentName) {
          self.scopes.set(assignmentName, key, left)
        }

        const result = yield* self.evaluateStatement(body).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              if (declaration) self.scopes.pop()
            }),
          ),
        )

        if (result.kind === "return") {
          return result
        }

        if (result.kind === "break") {
          return { kind: "none" }
        }

        if (result.kind === "continue") {
          continue
        }
      }

      return { kind: "none" }
    })
  }

  private evaluateBreakStatement(node: AstNode): StatementResult {
    const labelNode = getOptionalNode(node, "label")

    if (labelNode) {
      throw new InterpreterRuntimeError("Labeled break is not supported in v1.", node)
    }

    return { kind: "break" }
  }

  private evaluateContinueStatement(node: AstNode): StatementResult {
    const labelNode = getOptionalNode(node, "label")

    if (labelNode) {
      throw new InterpreterRuntimeError("Labeled continue is not supported in v1.", node)
    }

    return { kind: "continue" }
  }

  private evaluateThrowStatement(node: AstNode): Effect.Effect<StatementResult, unknown, R> {
    const argument = getNode(node, "argument")
    return Effect.flatMap(this.evaluateExpression(argument), (value) => Effect.fail(new ProgramThrow(value)))
  }

  private evaluateTryStatement(node: AstNode): Effect.Effect<StatementResult, unknown, R> {
    const body = getNode(node, "block")
    const handler = getOptionalNode(node, "handler")
    const finalizer = getOptionalNode(node, "finalizer")
    const self = this

    const attempted = Effect.matchCauseEffect(this.evaluateStatement(body), {
      onFailure: (cause) => {
        if (cause.reasons.some(Cause.isInterruptReason) || !handler) {
          return Effect.failCause(cause)
        }

        const caught = caughtErrorValue(Cause.squash(cause))
        const parameter = getOptionalNode(handler, "param")
        self.scopes.push()
        return Effect.gen(function* () {
          if (parameter) yield* self.declarePattern(parameter, caught, true, handler)
          return yield* self.evaluateStatement(getNode(handler, "body"))
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

  private evaluateVariableDeclaration(node: AstNode): Effect.Effect<void, unknown, R> {
    const kind = getString(node, "kind")
    const declarations = getArray(node, "declarations")
    const self = this
    return Effect.gen(function* () {
      for (const declarationValue of declarations) {
        const declaration = asNode(declarationValue, "declarations")

        if (declaration.type !== "VariableDeclarator") {
          throw new InterpreterRuntimeError("Unsupported variable declaration shape.", declaration)
        }

        const init = getOptionalNode(declaration, "init")
        const value = init ? yield* self.evaluateExpression(init) : undefined
        yield* self.declarePattern(getNode(declaration, "id"), value, kind !== "const", declaration)
      }
    })
  }

  private declarePattern(
    pattern: AstNode,
    value: unknown,
    mutable: boolean,
    node: AstNode,
  ): Effect.Effect<void, unknown, R> {
    const self = this
    return Effect.gen(function* () {
      if (pattern.type === "Identifier") {
        self.scopes.declare(getString(pattern, "name"), value, mutable, node)
        return
      }

      if (pattern.type === "AssignmentPattern") {
        const resolved = value === undefined ? yield* self.evaluateExpression(getNode(pattern, "right")) : value
        yield* self.declarePattern(getNode(pattern, "left"), resolved, mutable, node)
        return
      }

      if (pattern.type === "ObjectPattern") {
        if (value === null || typeof value !== "object" || Array.isArray(value) || isRuntimeReference(value)) {
          throw new InterpreterRuntimeError(
            "Object destructuring requires a data object value.",
            pattern,
            "InvalidDataValue",
          )
        }

        const consumed = new Set<string>()
        for (const propertyValue of getArray(pattern, "properties")) {
          const property = asNode(propertyValue, "properties")

          if (property.type === "RestElement") {
            const rest: SafeObject = Object.create(null) as SafeObject
            for (const [key, item] of Object.entries(value as SafeObject)) {
              if (!consumed.has(key) && !isBlockedMember(key)) rest[key] = item
            }
            yield* self.declarePattern(getNode(property, "argument"), rest, mutable, property)
            continue
          }

          if (
            property.type !== "Property" ||
            getBoolean(property, "computed") ||
            getString(property, "kind") !== "init"
          ) {
            throw new InterpreterRuntimeError("Only named object destructuring properties are supported.", property)
          }

          const keyNode = getNode(property, "key")
          const key = keyNode.type === "Identifier" ? getString(keyNode, "name") : String(keyNode.value)
          if (isBlockedMember(key)) {
            throw new InterpreterRuntimeError(`Property '${key}' is not available in CodeMode.`, keyNode)
          }
          consumed.add(key)
          yield* self.declarePattern(getNode(property, "value"), (value as SafeObject)[key], mutable, property)
        }
        return
      }

      if (pattern.type === "ArrayPattern") {
        if (!Array.isArray(value)) {
          throw new InterpreterRuntimeError("Array destructuring requires an array value.", pattern)
        }

        for (const [index, item] of getArray(pattern, "elements").entries()) {
          if (item === null) continue
          const element = asNode(item, `elements[${index}]`)
          if (element.type === "RestElement") {
            yield* self.declarePattern(getNode(element, "argument"), value.slice(index), mutable, element)
            break
          }
          yield* self.declarePattern(element, value[index], mutable, pattern)
        }
        return
      }

      throw new InterpreterRuntimeError(`Unsupported binding pattern '${pattern.type}'.`, pattern)
    })
  }

  private assignPattern(pattern: AstNode, value: unknown, node: AstNode): Effect.Effect<void, unknown, R> {
    const self = this
    return Effect.gen(function* () {
      if (pattern.type === "Identifier") {
        self.scopes.set(getString(pattern, "name"), value, pattern)
        return
      }

      if (pattern.type === "MemberExpression") {
        yield* self.writeMember(pattern, value)
        return
      }

      if (pattern.type === "AssignmentPattern") {
        const resolved = value === undefined ? yield* self.evaluateExpression(getNode(pattern, "right")) : value
        yield* self.assignPattern(getNode(pattern, "left"), resolved, node)
        return
      }

      if (pattern.type === "ObjectPattern") {
        if (value === null || typeof value !== "object" || Array.isArray(value) || isRuntimeReference(value)) {
          throw new InterpreterRuntimeError(
            "Object destructuring requires a data object value.",
            pattern,
            "InvalidDataValue",
          )
        }

        const source = value as SafeObject
        const consumed = new Set<string>()
        for (const propertyValue of getArray(pattern, "properties")) {
          const property = asNode(propertyValue, "properties")
          if (property.type === "RestElement") {
            const rest: SafeObject = Object.create(null) as SafeObject
            for (const [key, item] of Object.entries(source)) {
              if (!consumed.has(key) && !isBlockedMember(key)) rest[key] = item
            }
            yield* self.assignPattern(getNode(property, "argument"), rest, property)
            continue
          }
          if (
            property.type !== "Property" ||
            getBoolean(property, "computed") ||
            getString(property, "kind") !== "init"
          ) {
            throw new InterpreterRuntimeError("Only named object destructuring properties are supported.", property)
          }
          const keyNode = getNode(property, "key")
          const key = keyNode.type === "Identifier" ? getString(keyNode, "name") : String(keyNode.value)
          if (isBlockedMember(key)) {
            throw new InterpreterRuntimeError(`Property '${key}' is not available in CodeMode.`, keyNode)
          }
          consumed.add(key)
          yield* self.assignPattern(getNode(property, "value"), source[key], property)
        }
        return
      }

      if (pattern.type === "ArrayPattern") {
        if (!Array.isArray(value)) {
          throw new InterpreterRuntimeError("Array destructuring requires an array value.", pattern)
        }
        for (const [index, item] of getArray(pattern, "elements").entries()) {
          if (item === null) continue
          const element = asNode(item, `elements[${index}]`)
          if (element.type === "RestElement") {
            yield* self.assignPattern(getNode(element, "argument"), value.slice(index), element)
            break
          }
          yield* self.assignPattern(element, value[index], pattern)
        }
        return
      }

      throw new InterpreterRuntimeError(`Unsupported assignment pattern '${pattern.type}'.`, node)
    })
  }

  private evaluateExpression(node: AstNode): Effect.Effect<unknown, unknown, R> {
    switch (node.type) {
      case "Literal": {
        const regex = node.regex
        if (isRecord(regex) && typeof regex.pattern === "string") {
          return Effect.sync(() =>
            this.constructRegExp([regex.pattern, typeof regex.flags === "string" ? regex.flags : ""], node),
          )
        }
        return Effect.sync(() => boundedData(node.value, "Literal"))
      }
      case "Identifier":
        return Effect.sync(() => this.scopes.get(getString(node, "name"), node))
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
          let result: unknown
          for (const expression of getArray(node, "expressions")) {
            result = yield* self.evaluateExpression(asNode(expression, "expressions"))
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
        return Effect.map(this.evaluateExpression(getNode(node, "expression")), (value) =>
          value === OptionalShortCircuit ? undefined : value,
        )
      case "ObjectExpression":
        return this.evaluateObjectExpression(node)
      case "ArrayExpression":
        return this.evaluateArrayExpression(node)
      case "TemplateLiteral":
        return this.evaluateTemplateLiteral(node)
      case "ConditionalExpression":
        return this.evaluateConditionalExpression(node)
      case "UpdateExpression":
        return this.evaluateUpdateExpression(node)
      case "AwaitExpression": {
        // Await always suspends, including for plain values.
        const self = this
        return Effect.flatMap(this.evaluateExpression(getNode(node, "argument")), (value) =>
          value instanceof CodeModePromise ? self.settlePromise(value) : Effect.as(Effect.yieldNow, value),
        )
      }
      case "NewExpression":
        return this.evaluateNewExpression(node)
      default:
        throw unsupportedSyntax(node.type, node)
    }
  }

  private evaluateNewExpression(node: AstNode): Effect.Effect<unknown, unknown, R> {
    const callee = getNode(node, "callee")
    if (callee.type !== "Identifier") {
      throw unsupportedSyntax("NewExpression", node)
    }
    const name = getString(callee, "name")
    const argNodes = getArray(node, "arguments")
    const self = this
    if (name === "Promise") {
      return Effect.flatMap(this.evaluateCallArguments(argNodes), (args) =>
        constructPromise(self.runner, self.promises, args[0], node),
      )
    }
    if (errorConstructors.has(name)) {
      return Effect.map(this.evaluateCallArguments(argNodes), (args) => constructErrorValue(name, args, node))
    }
    // Array and Object construct identically with or without new, like JS.
    if (name === "Array") {
      return Effect.map(this.evaluateCallArguments(argNodes), (args) => self.constructArray(args, node))
    }
    if (name === "Object") {
      return Effect.map(this.evaluateCallArguments(argNodes), (args) => self.constructObject(args, node))
    }
    if (valueConstructors.has(name)) {
      return Effect.gen(function* () {
        const args = yield* self.evaluateCallArguments(argNodes)
        switch (name) {
          case "Date":
            return self.constructDate(args)
          case "RegExp":
            return self.constructRegExp(args, node)
          case "Map":
            return self.constructMap(args[0], node)
          case "Set":
            return self.constructSet(args[0], node)
          case "URL":
            return self.constructURL(args, node)
          default:
            return self.constructURLSearchParams(args[0], node)
        }
      })
    }
    throw unsupportedSyntax("NewExpression", node)
  }

  private constructArray(args: Array<unknown>, node: AstNode): Array<unknown> {
    if (args.length !== 1) return [...args]
    const first = args[0]
    if (typeof first !== "number") return [first]
    if (!Number.isInteger(first) || first < 0 || first > 4294967295) {
      throw new InterpreterRuntimeError("Invalid array length.", node).as("RangeError")
    }
    // Sparse like JS: Array(3) has holes, and combinator loops already skip them.
    return new Array(first)
  }

  private constructObject(args: Array<unknown>, node: AstNode): unknown {
    const first = args[0]
    if (first === null || first === undefined) return {}
    if (typeof first === "object") return first
    throw new InterpreterRuntimeError(
      `Object(${typeof first}) wrapper objects are not supported in CodeMode; use the primitive value directly.`,
      node,
    )
  }

  private constructDate(args: Array<unknown>): CodeModeDate {
    if (args.length === 0) return new CodeModeDate(Date.now())
    if (args.length === 1) {
      const arg = args[0]
      if (arg instanceof CodeModeDate) return new CodeModeDate(arg.time)
      if (typeof arg === "number") return new CodeModeDate(new Date(arg).getTime())
      if (typeof arg === "string") return new CodeModeDate(Date.parse(arg))
      return new CodeModeDate(Number.NaN)
    }
    const parts = args.map((arg) => coerceToNumber(arg))
    return new CodeModeDate(new Date(...(parts as [number, number])).getTime())
  }

  private constructRegExp(args: Array<unknown>, node: AstNode): CodeModeRegExp {
    const first = args[0]
    const pattern =
      first instanceof CodeModeRegExp ? first.regex.source : first === undefined ? "" : coerceToString(first)
    const flagsArg = args[1]
    if (flagsArg !== undefined && typeof flagsArg !== "string") {
      throw new InterpreterRuntimeError(
        `RegExp flags must be a string of flag characters (e.g. "g", "gi"), not ${flagsArg === null ? "null" : typeof flagsArg}.`,
        node,
      ).as("SyntaxError")
    }
    const flags = flagsArg ?? (first instanceof CodeModeRegExp ? first.regex.flags : "")
    try {
      return new CodeModeRegExp(pattern, flags)
    } catch (error) {
      const reason = regexFailureReason(error)
      throw new InterpreterRuntimeError(
        /flag/i.test(reason)
          ? `new RegExp(...) received invalid flags ${JSON.stringify(flags)} (${reason}). Valid flags are d, g, i, m, s, u, v, and y.`
          : `new RegExp(...) received ${JSON.stringify(pattern)}, which is not a valid regular expression pattern (${reason}). ${escapeRegexHint}`,
        node,
      ).as("SyntaxError")
    }
  }

  private constructMap(init: unknown, node: AstNode): CodeModeMap {
    const target = new CodeModeMap()
    if (init === undefined || init === null) return target
    const entries = Array.isArray(init)
      ? init
      : init instanceof CodeModeMap
        ? Array.from(init.map.entries(), ([key, item]): Array<unknown> => [key, item])
        : undefined
    if (entries === undefined) {
      throw new InterpreterRuntimeError(
        "new Map(...) expects an array of [key, value] pairs, a Map, or no argument.",
        node,
      )
    }
    for (const pair of entries) {
      if (!Array.isArray(pair)) {
        throw new InterpreterRuntimeError("new Map(...) expects [key, value] pairs.", node)
      }
      target.map.set(pair[0], pair[1])
    }
    return target
  }

  private constructSet(init: unknown, node: AstNode): CodeModeSet {
    const target = new CodeModeSet()
    if (init === undefined || init === null) return target
    const items = Array.isArray(init)
      ? init
      : init instanceof CodeModeSet
        ? Array.from(init.set.values())
        : typeof init === "string"
          ? Array.from(init)
          : undefined
    if (items === undefined) {
      throw new InterpreterRuntimeError("new Set(...) expects an array, Set, string, or no argument.", node)
    }
    for (const item of items) target.set.add(item)
    return target
  }

  private constructURL(args: Array<unknown>, node: AstNode): CodeModeURL {
    if (args.length === 0) {
      throw new InterpreterRuntimeError("new URL(...) requires a URL string and an optional base URL.", node).as(
        "TypeError",
      )
    }
    const input = urlArgument(args[0], "new URL input")
    const base = args[1] === undefined ? undefined : urlArgument(args[1], "new URL base")
    try {
      return new CodeModeURL(new URL(input, base))
    } catch {
      throw new InterpreterRuntimeError(
        `new URL(...) received an invalid URL${base === undefined ? "" : " or base URL"}.`,
        node,
      ).as("TypeError")
    }
  }

  private constructURLSearchParams(init: unknown, node: AstNode): CodeModeURLSearchParams {
    if (init === undefined) return new CodeModeURLSearchParams(new URLSearchParams())
    if (init instanceof CodeModeURLSearchParams) {
      return new CodeModeURLSearchParams(new URLSearchParams(init.params))
    }
    if (typeof init === "string") return new CodeModeURLSearchParams(new URLSearchParams(init))
    if (init === null || typeof init === "number" || typeof init === "boolean") {
      return new CodeModeURLSearchParams(new URLSearchParams(coerceToString(init)))
    }
    if (init instanceof CodeModeMap) {
      return this.constructURLSearchParams(
        Array.from(init.map.entries(), ([key, value]) => [key, value]),
        node,
      )
    }
    if (Array.isArray(init)) {
      const entries = init.map((pair) => {
        if (!Array.isArray(pair) || pair.length !== 2) {
          throw new InterpreterRuntimeError(
            "new URLSearchParams(...) expects an array of [name, value] pairs.",
            node,
          ).as("TypeError")
        }
        return [uriArgument(pair[0], "URLSearchParams name"), uriArgument(pair[1], "URLSearchParams value")] as [
          string,
          string,
        ]
      })
      return new CodeModeURLSearchParams(new URLSearchParams(entries))
    }
    if (isCodeModeValue(init)) return new CodeModeURLSearchParams(new URLSearchParams())
    const data = boundedData(init, "new URLSearchParams input")
    if (data === null || typeof data !== "object") {
      throw new InterpreterRuntimeError(
        "new URLSearchParams(...) expects a query string, data object, array of pairs, or URLSearchParams.",
        node,
      ).as("TypeError")
    }
    return new CodeModeURLSearchParams(
      new URLSearchParams(Object.fromEntries(Object.entries(data).map(([key, value]) => [key, coerceToString(value)]))),
    )
  }

  private evaluateBinaryExpression(node: AstNode): Effect.Effect<unknown, unknown, R> {
    const operator = getString(node, "operator")
    const self = this
    return Effect.gen(function* () {
      const lhs = yield* self.evaluateExpression(getNode(node, "left"))
      const rhs = yield* self.evaluateExpression(getNode(node, "right"))
      if (operator === "instanceof") return instanceofValue(lhs, rhs, node)
      return boundedData(self.applyBinaryOperator(operator, lhs, rhs, node), "Binary expression result")
    })
  }

  private applyBinaryOperator(operator: string, lhs: unknown, rhs: unknown, node: AstNode): unknown {
    if (containsOpaqueReference(lhs) || containsOpaqueReference(rhs)) {
      throw new InterpreterRuntimeError("Binary operators require data values in CodeMode.", node, "InvalidDataValue")
    }
    // Null-prototype data needs explicit primitive coercion; identity and `in` retain raw objects.
    // Dates use string coercion for `+` and epoch time elsewhere.
    const coerceOperand = (operand: unknown): unknown => {
      if (operand instanceof CodeModeDate) return operator === "+" ? coerceToString(operand) : operand.time
      return operand !== null && typeof operand === "object" ? coerceToString(operand) : operand
    }
    const bothObjects = lhs !== null && typeof lhs === "object" && rhs !== null && typeof rhs === "object"
    const l = coerceOperand(lhs)
    const r = coerceOperand(rhs)
    switch (operator) {
      case "+":
        return (l as string) + (r as string)
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
      case "===":
        return lhs === rhs
      case "!=":
        return bothObjects ? lhs !== rhs : l != r
      case "!==":
        return lhs !== rhs
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
        if (rhs === null || typeof rhs !== "object") {
          throw new InterpreterRuntimeError("The 'in' operator requires a data object on the right-hand side.", node)
        }
        // Never expose properties inherited from host prototypes.
        return Object.hasOwn(rhs as object, coerceOperand(lhs) as PropertyKey)
      default:
        throw new InterpreterRuntimeError(`Unsupported binary operator '${operator}'.`, node)
    }
  }

  private evaluateLogicalExpression(node: AstNode): Effect.Effect<unknown, unknown, R> {
    const operator = getString(node, "operator")
    return Effect.flatMap(this.evaluateExpression(getNode(node, "left")), (left) => {
      if (operator === "&&") return left ? this.evaluateExpression(getNode(node, "right")) : Effect.succeed(left)
      if (operator === "||") return left ? Effect.succeed(left) : this.evaluateExpression(getNode(node, "right"))
      if (operator === "??")
        return left !== null && left !== undefined
          ? Effect.succeed(left)
          : this.evaluateExpression(getNode(node, "right"))
      throw new InterpreterRuntimeError(`Unsupported logical operator '${operator}'.`, node)
    })
  }

  private evaluateUnaryExpression(node: AstNode): Effect.Effect<unknown, unknown, R> {
    const operator = getString(node, "operator")
    const argument = getNode(node, "argument")
    // Undeclared names short-circuit, but declared TDZ bindings must still throw.
    if (operator === "typeof" && argument.type === "Identifier" && !this.scopes.resolve(getString(argument, "name"))) {
      return Effect.succeed("undefined")
    }
    return Effect.map(this.evaluateExpression(argument), (value) => {
      if (operator === "typeof") return typeofValue(value)
      if (operator === "!") return !value
      if (containsOpaqueReference(value)) {
        throw new InterpreterRuntimeError("Unary operators require data values in CodeMode.", node, "InvalidDataValue")
      }
      const operand =
        value instanceof CodeModeDate
          ? value.time
          : value !== null && typeof value === "object"
            ? coerceToString(value)
            : value
      let result: unknown
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
          throw new InterpreterRuntimeError(`Unsupported unary operator '${operator}'.`, node)
      }
      return boundedData(result, "Unary expression result")
    })
  }

  private evaluateAssignmentExpression(node: AstNode): Effect.Effect<unknown, unknown, R> {
    const left = getNode(node, "left")
    const operator = getString(node, "operator")
    const self = this
    return Effect.gen(function* () {
      if (operator === "??=" || operator === "||=" || operator === "&&=") {
        return yield* self.evaluateLogicalAssignment(node, left, operator)
      }
      if (operator === "=" && (left.type === "ObjectPattern" || left.type === "ArrayPattern")) {
        const rightValue = yield* self.evaluateExpression(getNode(node, "right"))
        yield* self.assignPattern(left, rightValue, node)
        return rightValue
      }
      if (left.type === "Identifier") {
        const name = getString(left, "name")
        if (operator !== "=") {
          const current = self.scopes.get(name, left)
          const rightValue = yield* self.evaluateExpression(getNode(node, "right"))
          const next = boundedData(
            self.applyCompoundAssignment(operator, current, rightValue, node),
            "Assignment result",
          )
          return self.scopes.set(name, next, left)
        }
        const rightValue = yield* self.evaluateExpression(getNode(node, "right"))
        return self.scopes.set(name, rightValue, left)
      }
      if (left.type === "MemberExpression") {
        return yield* self.modifyMember(left, (current) =>
          Effect.map(self.evaluateExpression(getNode(node, "right")), (rightValue) => {
            if (operator === "=") return { write: true, next: rightValue, result: rightValue }
            const next = boundedData(
              self.applyCompoundAssignment(operator, current, rightValue, node),
              "Assignment result",
            )
            return { write: true, next, result: next }
          }),
        )
      }
      throw new InterpreterRuntimeError("Assignment target must be an Identifier or MemberExpression.", left)
    })
  }

  private evaluateLogicalAssignment(
    node: AstNode,
    left: AstNode,
    operator: string,
  ): Effect.Effect<unknown, unknown, R> {
    const self = this
    const shouldAssign = (current: unknown): boolean =>
      operator === "??=" ? current === null || current === undefined : operator === "||=" ? !current : Boolean(current)
    if (left.type === "Identifier") {
      const name = getString(left, "name")
      return Effect.gen(function* () {
        const current = self.scopes.get(name, left)
        if (!shouldAssign(current)) return current
        const rightValue = yield* self.evaluateExpression(getNode(node, "right"))
        return self.scopes.set(name, rightValue, left)
      })
    }
    if (left.type === "MemberExpression") {
      return self.modifyMember(left, (current) =>
        shouldAssign(current)
          ? Effect.map(self.evaluateExpression(getNode(node, "right")), (rightValue) => ({
              write: true,
              next: rightValue,
              result: rightValue,
            }))
          : Effect.succeed({ write: false, next: current, result: current }),
      )
    }
    throw new InterpreterRuntimeError("Assignment target must be an Identifier or MemberExpression.", left)
  }

  private evaluateUpdateExpression(node: AstNode): Effect.Effect<unknown, unknown, R> {
    const operator = getString(node, "operator")
    const argument = getNode(node, "argument")
    const prefix = getBoolean(node, "prefix")

    const increment = operator === "++" ? 1 : operator === "--" ? -1 : undefined

    if (increment === undefined) {
      throw new InterpreterRuntimeError(`Unsupported update operator '${operator}'.`, node)
    }

    if (argument.type === "Identifier") {
      return Effect.sync(() => {
        const name = getString(argument, "name")
        const current = Number(this.scopes.get(name, argument))
        const next = current + increment
        this.scopes.set(name, next, argument)
        return prefix ? next : current
      })
    }

    if (argument.type === "MemberExpression") {
      return this.modifyMember(argument, (current) => {
        const value = Number(current)
        const next = value + increment
        return Effect.succeed({ write: true, next, result: prefix ? next : value })
      })
    }

    throw new InterpreterRuntimeError("Update target must be an Identifier or MemberExpression.", argument)
  }

  private evaluateCallExpression(node: AstNode): Effect.Effect<unknown, unknown, R> {
    const callee = getNode(node, "callee")
    const argNodes = getArray(node, "arguments")

    const self = this
    return Effect.gen(function* () {
      const callable = yield* self.evaluateExpression(callee)
      if (callable === OptionalShortCircuit) return OptionalShortCircuit
      if ((callable === null || callable === undefined) && node.optional === true) return OptionalShortCircuit

      const args = yield* self.evaluateCallArguments(argNodes)
      return yield* self.invokeCallable(callable, args, node, callee)
    })
  }

  // The single dispatch for every invocation: call expressions and callbacks share it.
  private invokeCallable(
    callable: unknown,
    args: Array<unknown>,
    node: AstNode,
    callee: AstNode = node,
  ): Effect.Effect<unknown, unknown, R> {
    const self = this
    return Effect.gen(function* () {
      if (callable instanceof ToolReference) {
        if (callable.path.length === 0) throw new InterpreterRuntimeError("The tools root is not callable.", callee)
        return yield* self.createToolCallPromise(callable.path, args)
      }
      if (callable instanceof PromiseMethodReference) {
        return yield* invokePromiseMethod(self.runner, self.promises, callable, args, node)
      }
      if (callable instanceof PromiseInstanceMethodReference) {
        return yield* invokePromiseInstanceMethod(self.runner, self.promises, callable, args, node)
      }
      if (callable instanceof CodeModeFunction) {
        return yield* self.invokeFunction(callable, args)
      }
      if (callable instanceof IntrinsicReference) {
        return yield* invokeIntrinsic(self.runner, callable, args, node)
      }
      if (callable instanceof GlobalMethodReference) {
        if (callable.namespace === "console") return self.invokeConsole(callable.name, args, node)
        if (callable.namespace === "Object" && args[0] instanceof ToolReference) {
          return self.invokeObjectMethodOnTools(callable.name, args[0], node)
        }
        if (callable.namespace === "Object" && objectMethodsPreservingIdentity.has(callable.name)) {
          return invokeGlobalMethod(callable, args, node)
        }
        if (callable.namespace === "Array" && callable.name === "from") {
          return yield* invokeArrayFrom(self.runner, args, node)
        }
        if (callable.namespace === "Array" && callable.name === "of") {
          return invokeGlobalMethod(callable, args, node)
        }
        return boundedData(invokeGlobalMethod(callable, args, node), `${callable.namespace}.${callable.name} result`)
      }
      if (callable instanceof CoercionFunction) {
        return boundedData(invokeCoercion(callable, args, node), `${callable.name} result`)
      }
      if (callable instanceof UriFunction) {
        return invokeUriFunction(callable, args, node)
      }
      if (callable instanceof SearchFunction) {
        return yield* self.invokeSearch(args)
      }
      if (callable instanceof ErrorConstructorReference) {
        return constructErrorValue(callable.name, args, node)
      }
      if (callable instanceof GlobalNamespace) {
        // Real JS permits calling Array, Object, Date, and RegExp without new.
        if (callable.name === "Array") return self.constructArray(args, node)
        if (callable.name === "Object") return self.constructObject(args, node)
        // ISO instead of the host's locale string: CodeMode date strings are
        // deterministic and must not leak the host timezone.
        if (callable.name === "Date") return new Date().toISOString()
        if (callable.name === "RegExp") return self.constructRegExp(args, node)
        if (typeofValue(callable) === "function") {
          throw new InterpreterRuntimeError(`Constructor ${callable.name} requires 'new'.`, node).as("TypeError")
        }
        throw new InterpreterRuntimeError(`${callable.name} is not a function.`, node).as("TypeError")
      }
      if (callable instanceof PromiseNamespace) {
        throw new InterpreterRuntimeError("Constructor Promise requires 'new'.", node).as("TypeError")
      }
      if (callable instanceof PromiseCapabilityFunction) {
        callable.settle(args[0])
        return undefined
      }
      throw new InterpreterRuntimeError("Only tools are callable in CodeMode.", callee)
    })
  }

  private invokeObjectMethodOnTools(name: string, ref: ToolReference, node: AstNode): unknown {
    if (name === "keys") {
      return boundedData(this.enumerableKeys(ref)!, "Object.keys result")
    }
    throw new InterpreterRuntimeError(
      `Object.${name}(...) cannot read tool references: they are not plain data. Use Object.keys(tools) for names, or search({ query }) for signatures.`,
      node,
      "InvalidDataValue",
    )
  }

  private invokeConsole(name: string, args: Array<unknown>, node: AstNode): undefined {
    if (!consoleMethods.has(name))
      throw new InterpreterRuntimeError(`console.${name} is not available in CodeMode.`, node)
    this.logs.push(formatConsoleMessage(name, args))
    return undefined
  }

  private evaluateCallArguments(argNodes: Array<unknown>): Effect.Effect<Array<unknown>, unknown, R> {
    const self = this
    return Effect.gen(function* () {
      const args: Array<unknown> = []
      for (const [index, arg] of argNodes.entries()) {
        const argNode = asNode(arg, `arguments[${index}]`)
        if (argNode.type === "SpreadElement") {
          const spread = yield* self.evaluateExpression(getNode(argNode, "argument"))
          const items = spreadItems(spread)
          if (items === undefined)
            throw new InterpreterRuntimeError(
              "Spread arguments require an array, string, Map, or Set in CodeMode.",
              argNode,
            )
          args.push(...items)
        } else {
          args.push(yield* self.evaluateExpression(argNode))
        }
      }
      return args
    })
  }

  private invokeFunction(fn: CodeModeFunction, args: Array<unknown>): Effect.Effect<unknown, unknown, R> {
    const invocation = new Interpreter(this.invokeTool, this.invokeSearch, this.toolKeys, this.promises, this.logs)
    invocation.scopes = new ScopeStack([...fn.capturedScopes, new Map()])
    const run = Effect.gen(function* () {
      // Seed all parameters first so defaults cannot fall through to same-named outer bindings.
      const paramScope = invocation.scopes.current()
      for (const parameter of fn.parameters) {
        for (const name of collectPatternNames(parameter)) {
          paramScope.set(name, { mutable: true, value: undefined, initialized: false })
        }
      }
      for (const [index, parameter] of fn.parameters.entries()) {
        if (parameter.type === "RestElement") {
          yield* invocation.declarePattern(getNode(parameter, "argument"), args.slice(index), true, parameter)
          break
        }
        yield* invocation.declarePattern(parameter, args[index], true, parameter)
      }

      if (fn.body.type === "BlockStatement") {
        const result = yield* invocation.evaluateStatement(fn.body)
        return result.kind === "return" ? result.value : undefined
      }

      return yield* invocation.evaluateExpression(fn.body)
    })
    if (!fn.async) return run
    // The initial yield assigns `box.own` before the body can self-resolve.
    const box: { own?: CodeModePromise } = {}
    return Effect.map(
      this.createPromise(
        Effect.flatMap(run, (value) => {
          if (!(value instanceof CodeModePromise)) return Effect.succeed(value)
          if (value === box.own) return Effect.fail(selfResolutionError())
          return invocation.settlePromise(value)
        }),
      ),
      (promise) => {
        box.own = promise
        return promise
      },
    )
  }

  private evaluateObjectExpression(node: AstNode): Effect.Effect<Record<string, unknown>, unknown, R> {
    const objectValue: Record<string, unknown> = Object.create(null) as Record<string, unknown>
    const properties = getArray(node, "properties")
    const self = this
    return Effect.gen(function* () {
      for (const propertyValue of properties) {
        const property = asNode(propertyValue, "properties")

        if (property.type === "SpreadElement") {
          const spread = yield* self.evaluateExpression(getNode(property, "argument"))
          if (spread === null || spread === undefined || isCodeModeValue(spread)) continue
          if (typeof spread !== "object" || Array.isArray(spread) || isRuntimeReference(spread)) {
            throw new InterpreterRuntimeError(
              "Object spread requires a data object in CodeMode.",
              property,
              "InvalidDataValue",
            )
          }
          for (const [key, value] of Object.entries(spread)) {
            if (isBlockedMember(key))
              throw new InterpreterRuntimeError(`Property '${key}' is not available in CodeMode.`, property)
            objectValue[key] = value
          }
          continue
        }

        if (property.type !== "Property") {
          throw new InterpreterRuntimeError("Only standard object properties are supported.", property)
        }

        if (getString(property, "kind") !== "init") {
          throw new InterpreterRuntimeError("Only init object properties are supported.", property)
        }

        const keyNode = getNode(property, "key")
        const valueNode = getNode(property, "value")
        const computed = getBoolean(property, "computed")

        let key: PropertyKey

        if (computed) {
          key = self.toPropertyKey(yield* self.evaluateExpression(keyNode), keyNode)
        } else if (keyNode.type === "Identifier") {
          key = getString(keyNode, "name")
        } else if (keyNode.type === "Literal") {
          key = self.toPropertyKey(keyNode.value, keyNode)
        } else {
          throw new InterpreterRuntimeError("Unsupported object property key shape.", keyNode)
        }

        if (isBlockedMember(String(key))) {
          throw new InterpreterRuntimeError(`Property '${String(key)}' is not available in CodeMode.`, keyNode)
        }
        objectValue[String(key)] = yield* self.evaluateExpression(valueNode)
      }

      return objectValue
    })
  }

  private evaluateArrayExpression(node: AstNode): Effect.Effect<Array<unknown>, unknown, R> {
    const elements = getArray(node, "elements")
    const values: Array<unknown> = []

    const self = this
    return Effect.gen(function* () {
      for (const elementValue of elements) {
        if (elementValue === null) {
          // A literal elision is a real hole, like JS: extend length without an own index.
          values.length += 1
          continue
        }
        const element = asNode(elementValue, "elements")
        if (element.type === "SpreadElement") {
          const spread = yield* self.evaluateExpression(getNode(element, "argument"))
          const items = spreadItems(spread)
          if (items === undefined)
            throw new InterpreterRuntimeError(
              "Array spread requires an array, string, Map, or Set in CodeMode.",
              element,
            )
          values.push(...items)
        } else {
          values.push(yield* self.evaluateExpression(element))
        }
      }
      return values
    })
  }

  private evaluateTemplateLiteral(node: AstNode): Effect.Effect<string, unknown, R> {
    const quasis = getArray(node, "quasis")
    const expressions = getArray(node, "expressions")

    let output = ""

    const self = this
    return Effect.gen(function* () {
      for (let index = 0; index < quasis.length; index += 1) {
        const quasi = asNode(quasis[index], "quasis")
        const rawValue = quasi.value

        if (!isRecord(rawValue) || typeof rawValue.cooked !== "string") {
          throw new InterpreterRuntimeError("Invalid template literal quasi.", quasi)
        }

        output += rawValue.cooked

        if (index < expressions.length) {
          const raw = yield* self.evaluateExpression(asNode(expressions[index], "expressions"))
          output += coerceToString(boundedData(raw, "Template interpolation"))
        }
      }

      return output
    })
  }

  private evaluateConditionalExpression(node: AstNode): Effect.Effect<unknown, unknown, R> {
    return Effect.flatMap(this.evaluateExpression(getNode(node, "test")), (test) =>
      this.evaluateExpression(getNode(node, test ? "consequent" : "alternate")),
    )
  }

  private applyCompoundAssignment(operator: string, current: unknown, incoming: unknown, node: AstNode): unknown {
    if (!compoundOperators.has(operator)) {
      throw new InterpreterRuntimeError(`Unsupported assignment operator '${operator}'.`, node)
    }
    return this.applyBinaryOperator(operator.slice(0, -1), current, incoming, node)
  }

  private getMemberReference(
    node: AstNode,
  ): Effect.Effect<
    | MemberReference
    | ToolReference
    | PromiseMethodReference
    | PromiseInstanceMethodReference
    | IntrinsicReference
    | GlobalMethodReference
    | ComputedValue
    | typeof OptionalShortCircuit
    | undefined,
    unknown,
    R
  > {
    const objectNode = getNode(node, "object")
    const propertyNode = getNode(node, "property")
    const computed = getBoolean(node, "computed")
    const optional = node.optional === true
    const self = this
    return Effect.gen(function* () {
      const objectValue = yield* self.evaluateExpression(objectNode)
      if (objectValue === OptionalShortCircuit) return OptionalShortCircuit
      if ((objectValue === null || objectValue === undefined) && optional) return OptionalShortCircuit

      const key = computed
        ? self.toPropertyKey(yield* self.evaluateExpression(propertyNode), propertyNode)
        : propertyNode.type === "Identifier"
          ? getString(propertyNode, "name")
          : self.toPropertyKey(yield* self.evaluateExpression(propertyNode), propertyNode)

      if (objectValue instanceof ToolReference) {
        if (typeof key !== "string") {
          throw new InterpreterRuntimeError("Tool paths must use string property names.", propertyNode)
        }
        return new ToolReference([...objectValue.path, key])
      }

      if (objectValue instanceof PromiseNamespace) {
        if (typeof key === "string" && promiseStatics.has(key as PromiseMethodName)) {
          return new PromiseMethodReference(key as PromiseMethodName)
        }
        throw new InterpreterRuntimeError(
          `Promise.${String(key)} is not available in CodeMode. Available: Promise.all, Promise.allSettled, Promise.race, Promise.any, Promise.resolve, and Promise.reject; consume promises with await.`,
          propertyNode,
        )
      }

      if (objectValue instanceof GlobalNamespace) {
        if (typeof key !== "string" || isBlockedMember(key)) {
          throw new InterpreterRuntimeError(
            `${objectValue.name}.${String(key)} is not available in CodeMode.`,
            propertyNode,
          )
        }
        if (objectValue.name === "Math" && mathConstants.has(key)) {
          return new ComputedValue((Math as unknown as Record<string, number>)[key])
        }
        return new GlobalMethodReference(objectValue.name, key)
      }

      if (typeof objectValue === "string") {
        if (key === "length") return new ComputedValue(objectValue.length)
        if (typeof key === "number") return new ComputedValue(objectValue[key])
        if (typeof key === "string" && /^\d+$/.test(key)) return new ComputedValue(objectValue[Number(key)])
        if (typeof key === "string" && stringMethods.has(key)) return new IntrinsicReference(objectValue, key)
        return new ComputedValue(undefined)
      }

      if (typeof objectValue === "number") {
        if (typeof key === "string" && numberMethods.has(key)) return new IntrinsicReference(objectValue, key)
        return new ComputedValue(undefined)
      }

      if (objectValue instanceof CoercionFunction && typeof key === "string" && !isBlockedMember(key)) {
        if (objectValue.name === "Number" && numberConstants.has(key)) {
          return new ComputedValue((Number as unknown as Record<string, number>)[key])
        }
        if (objectValue.name === "Number" && numberStatics.has(key)) return new GlobalMethodReference("Number", key)
        if (objectValue.name === "String" && stringStatics.has(key)) return new GlobalMethodReference("String", key)
      }

      if (objectValue instanceof CodeModeDate) {
        if (typeof key === "string" && dateMethods.has(key)) return new IntrinsicReference(objectValue, key)
        return new ComputedValue(undefined)
      }
      if (objectValue instanceof CodeModeRegExp) {
        if (typeof key === "string" && regexpProperties.has(key)) {
          return new ComputedValue((objectValue.regex as unknown as Record<string, unknown>)[key])
        }
        if (typeof key === "string" && regexpMethods.has(key)) return new IntrinsicReference(objectValue, key)
        return new ComputedValue(undefined)
      }
      if (objectValue instanceof CodeModeMap) {
        if (key === "size") return new ComputedValue(objectValue.map.size)
        if (typeof key === "string" && mapMethods.has(key)) return new IntrinsicReference(objectValue, key)
        return new ComputedValue(undefined)
      }
      if (objectValue instanceof CodeModeSet) {
        if (key === "size") return new ComputedValue(objectValue.set.size)
        if (typeof key === "string" && setMethods.has(key)) return new IntrinsicReference(objectValue, key)
        return new ComputedValue(undefined)
      }
      if (objectValue instanceof CodeModeURL) {
        if (key === "searchParams") {
          return new ComputedValue(objectValue.searchParams)
        }
        if (typeof key === "string" && urlMethods.has(key)) return new IntrinsicReference(objectValue, key)
        if (typeof key === "string" && urlProperties.has(key)) return { target: objectValue, key }
        return new ComputedValue(undefined)
      }
      if (objectValue instanceof CodeModeURLSearchParams) {
        if (key === "size") return new ComputedValue(objectValue.params.size)
        if (typeof key === "string" && urlSearchParamsMethods.has(key)) {
          return new IntrinsicReference(objectValue, key)
        }
        return new ComputedValue(undefined)
      }

      // Reject unknown promise properties so a missing await cannot hide.
      if (objectValue instanceof CodeModePromise) {
        if (key === "then" || key === "catch" || key === "finally") {
          return new PromiseInstanceMethodReference(objectValue, key)
        }
        throw new InterpreterRuntimeError(
          "This value is an un-awaited Promise; await it first - e.g. `const result = await tools.ns.tool(...)`.",
          objectNode,
          "InvalidDataValue",
        )
      }

      if (isRuntimeReference(objectValue)) {
        throw new InterpreterRuntimeError(
          "CodeMode runtime references are opaque and do not expose properties.",
          objectNode,
          "InvalidDataValue",
        )
      }

      if (typeof objectValue !== "object" || objectValue === null) {
        throw new InterpreterRuntimeError("Cannot access a property on a non-object value.", objectNode)
      }

      if (typeof key === "string" && isBlockedMember(key)) {
        throw new InterpreterRuntimeError(`Property '${key}' is not available in CodeMode.`, propertyNode)
      }

      if (Array.isArray(objectValue)) {
        if (
          key !== "length" &&
          !(typeof key === "string" && arrayMethods.has(key)) &&
          typeof key !== "number" &&
          !/^\d+$/.test(key)
        ) {
          if (typeof key === "string" && Object.hasOwn(objectValue, key)) {
            return new ComputedValue((objectValue as Record<string, unknown> & Array<unknown>)[key])
          }
          return new ComputedValue(undefined)
        }
        return { target: objectValue, key }
      }

      return { target: objectValue as SafeObject, key }
    })
  }

  private readMember(node: AstNode): Effect.Effect<unknown, unknown, R> {
    return Effect.map(this.getMemberReference(node), (reference) => {
      if (reference === OptionalShortCircuit) return OptionalShortCircuit
      if (reference instanceof ComputedValue) return reference.value
      if (
        reference === undefined ||
        reference instanceof ToolReference ||
        reference instanceof PromiseMethodReference ||
        reference instanceof PromiseInstanceMethodReference ||
        reference instanceof IntrinsicReference ||
        reference instanceof GlobalMethodReference
      )
        return reference
      if (Array.isArray(reference.target)) {
        if (typeof reference.key === "string" && arrayMethods.has(reference.key)) {
          return new IntrinsicReference(reference.target, reference.key)
        }
        return reference.key === "length" ? reference.target.length : reference.target[Number(reference.key)]
      }
      if (reference.target instanceof CodeModeURL) {
        return (reference.target.url as unknown as Record<string, unknown>)[String(reference.key)]
      }
      return reference.target[String(reference.key)]
    })
  }

  private writeMember(node: AstNode, value: unknown): Effect.Effect<unknown, unknown, R> {
    return this.modifyMember(node, () => Effect.succeed({ write: true, next: value, result: value }))
  }

  // Resolve side-effecting object and key expressions exactly once.
  private modifyMember(
    node: AstNode,
    compute: (current: unknown) => Effect.Effect<{ write: boolean; next: unknown; result: unknown }, unknown, R>,
  ): Effect.Effect<unknown, unknown, R> {
    const self = this
    return Effect.gen(function* () {
      const reference = yield* self.getMemberReference(node)
      if (
        reference === OptionalShortCircuit ||
        reference instanceof ComputedValue ||
        reference === undefined ||
        reference instanceof ToolReference ||
        reference instanceof PromiseMethodReference ||
        reference instanceof PromiseInstanceMethodReference ||
        reference instanceof IntrinsicReference ||
        reference instanceof GlobalMethodReference
      ) {
        throw new InterpreterRuntimeError("Only data fields may be assigned in CodeMode.", node)
      }
      if (Array.isArray(reference.target)) {
        if (reference.key === "length")
          throw new InterpreterRuntimeError("Array length cannot be assigned in CodeMode.", node)
        if (typeof reference.key === "string" && arrayMethods.has(reference.key)) {
          throw new InterpreterRuntimeError("Array methods cannot be assigned in CodeMode.", node)
        }
      }
      const key = Array.isArray(reference.target) ? Number(reference.key) : String(reference.key)
      const current =
        reference.target instanceof CodeModeURL
          ? (reference.target.url as unknown as Record<string, unknown>)[key]
          : (reference.target as Record<PropertyKey, unknown>)[key]
      const { write, next, result } = yield* compute(current)
      if (write) self.assignToReference(reference, key, next, node)
      return result
    })
  }

  private assignToReference(reference: MemberReference, key: number | string, next: unknown, node: AstNode): void {
    if (Array.isArray(reference.target)) {
      const target = reference.target
      const index = key as number
      if (!Number.isInteger(index) || index < 0) {
        throw new InterpreterRuntimeError(
          "Array assignment index must be a non-negative integer.",
          node,
          "InvalidDataValue",
        )
      }
      rejectCircularInsertion(target, next, "Array assignment result", node)
      target[index] = next
      return
    }
    if (reference.target instanceof CodeModeURL) {
      const property = key as string
      if (!urlWritableProperties.has(property)) {
        throw new InterpreterRuntimeError(`URL.${property} is read-only.`, node).as("TypeError")
      }
      try {
        const url = reference.target.url as unknown as Record<string, string>
        url[property] = uriArgument(next, `URL.${property} value`)
        return
      } catch (error) {
        if (error instanceof InterpreterRuntimeError || error instanceof ToolRuntimeError) throw error
        throw new InterpreterRuntimeError(`URL.${property} received an invalid value.`, node).as("TypeError")
      }
    }
    const target = reference.target as SafeObject
    const objectKey = key as string
    rejectCircularInsertion(target, next, "Object assignment result", node)
    target[objectKey] = next
  }

  private toPropertyKey(value: unknown, node: AstNode): string | number {
    if (typeof value === "string" || typeof value === "number") {
      return value
    }

    throw new InterpreterRuntimeError("Property key must be a string or number.", node)
  }
}
