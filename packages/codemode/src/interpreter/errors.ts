import { Effect } from "effect"
import type { Diagnostic } from "../codemode.js"
import { ToolError } from "../tool-error.js"
import { ToolRuntimeError } from "../tool-runtime.js"
import { type AstNode, formatLocation, PendingThrow, Throw, sourceLocation, typeError } from "./model.js"
import { containsRuntimeReference } from "./references.js"
import { createErrorValue, type ErrorType, isErrorType } from "./intrinsics.js"
import { constructor, methods, prototypeFrom, receiver } from "./native.js"
import { type Callable, define, get, hidden, type Native, Arr, ErrorObj, Obj } from "./objects.js"
import type { Interpreter } from "./interpreter.js"
import { formatValue } from "../stdlib/console.js"
import { coerceToString } from "../stdlib/value.js"

export const normalizeError = (error: unknown): Diagnostic => {
  if (error instanceof PendingThrow) {
    return {
      kind: error.kind,
      message: `${error.type}: ${error.message}${formatLocation(error.node)}`,
      ...(error.node?.loc ? { location: sourceLocation(error.node) } : {}),
      ...(error.suggestions ? { suggestions: error.suggestions } : {}),
    }
  }

  if (error instanceof ToolRuntimeError) {
    return {
      kind: error.kind,
      message: error.message,
      ...(error.suggestions.length > 0 ? { suggestions: error.suggestions } : {}),
    }
  }

  if (error instanceof ToolError) {
    return { kind: "ToolFailure", message: error.message }
  }

  if (error instanceof Throw) {
    const value = error.value
    if (value instanceof ErrorObj) {
      return value.host ? normalizeError(value.host) : { kind: "ExecutionFailure", message: errorToString(value) }
    }
    let message: string
    if (containsRuntimeReference(value)) {
      // Never expose runtime reference internals through thrown values.
      message = "a non-data value"
    } else if (typeof value === "string") {
      message = value
    } else {
      message = formatValue(value)
    }
    return { kind: "ExecutionFailure", message: `Uncaught: ${message}` }
  }

  if (error instanceof RangeError && /call stack|recursion/i.test(error.message)) {
    return {
      kind: "ExecutionFailure",
      message: "Execution exceeded the maximum nesting depth.",
    }
  }

  if (error instanceof Error) {
    return {
      kind: error.name === "SyntaxError" ? "ParseError" : "ExecutionFailure",
      message: error.message,
    }
  }

  return {
    kind: "ExecutionFailure",
    message: String(error),
  }
}

/**
 * Gives a failure the source location of the expression that raised it, keeping the first one attached. Host errors
 * that escape a built-in become the equivalent program error here.
 */
export const locate = (error: unknown, node?: AstNode): unknown => {
  if (error instanceof PendingThrow) {
    if (error.node === undefined && node) error.node = node
    return error
  }
  if (error instanceof Error && !(error instanceof ToolError) && !(error instanceof ToolRuntimeError)) {
    return new PendingThrow(isErrorType(error.name) ? error.name : "Error", error.message, node)
  }
  return error
}

/** The program value a handler receives for a failure; one failure always yields the same value. */
export const materialize = <R>(ctx: Interpreter<R>, thrown: unknown): unknown => {
  if (thrown instanceof Throw) return thrown.value
  const builtins = ctx.builtins
  if (thrown instanceof PendingThrow) {
    if (thrown.value === undefined) {
      thrown.value = createErrorValue(builtins[thrown.type], thrown.message)
      thrown.value.host = thrown
    }
    return thrown.value
  }
  const type = thrown instanceof Error && isErrorType(thrown.name) ? thrown.name : "Error"
  return createErrorValue(builtins[type], normalizeError(thrown).message)
}

/** Error.prototype.toString: `name: message`, omitting whichever side is empty. */
const errorToString = (self: Obj): string => {
  const name = get(self, "name")
  const message = get(self, "message")
  const shownName = name === undefined ? "Error" : coerceToString(name)
  const shownMessage = message === undefined ? "" : coerceToString(message)
  if (shownMessage === "") return shownName
  if (shownName === "") return shownMessage
  return `${shownName}: ${shownMessage}`
}

export const createAggregateErrorValue = <R>(
  ctx: Interpreter<R>,
  errors: Array<unknown>,
  message: string,
  proto: Obj = ctx.builtins.AggregateError,
) => {
  const value = createErrorValue(proto, message)
  define(value, "errors", new Arr(ctx.builtins.Array, errors), { ...hidden })
  return value
}

const constructAggregateErrorValue = <R>(
  ctx: Interpreter<R>,
  args: Array<unknown>,
  proto: Obj,
): Effect.Effect<ErrorObj, unknown, R> =>
  Effect.gen(function* () {
    const cursor = yield* ctx.iterate(args[0])
    if (cursor === undefined) throw typeError("new AggregateError(...) expects a synchronous iterable of errors.")
    const errors: Array<unknown> = []
    while (true) {
      const step = yield* cursor.next
      if (step.done) {
        return createAggregateErrorValue(ctx, errors, args[1] === undefined ? "" : coerceToString(args[1]), proto)
      }
      errors.push(step.value)
    }
  })

/** An error constructor such as `Error` or `TypeError`; callable with or without `new`, like JS. */
export const errorGlobal = <R>(type: ErrorType, ctx: Interpreter<R>) => {
  const builtins = ctx.builtins
  const prototype = builtins[type]
  const construct = (args: Array<unknown>, newTarget: Callable) => {
    const proto = prototypeFrom(newTarget, prototype)
    return type === "AggregateError"
      ? constructAggregateErrorValue(ctx, args, proto)
      : Effect.sync(() => createErrorValue(proto, args[0] === undefined ? undefined : coerceToString(args[0])))
  }
  const ctor: Native<R> = constructor<R>(builtins, prototype, {
    name: type,
    length: type === "AggregateError" ? 2 : 1,
    call: (_, args) => construct(args, ctor),
    construct,
  })
  if (type === "Error") {
    methods(builtins, prototype, [
      ["toString", 0, (thisValue) => errorToString(receiver(Obj, thisValue, "Error.prototype.toString"))],
    ])
  }
  return ctor
}
