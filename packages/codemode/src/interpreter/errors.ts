import { consumer, STATE } from "../machine/native-kind.js"
import type { Diagnostic } from "../codemode.js"
import { ToolError } from "../tool-error.js"
import { ToolRuntimeError } from "../tool-runtime.js"
import { type AstNode, formatLocation, PendingThrow, Throw, sourceLocation, typeError } from "./model.js"
import { containsRuntimeReference } from "./references.js"
import { createErrorValue, type ErrorType, isErrorType } from "./intrinsics.js"
import { constructor, methods, prototypeFrom, receiver } from "./native.js"
import {
  type Callable,
  define,
  get,
  has,
  hidden,
  type Native,
  Arr,
  ErrorObj,
  Obj,
  coerceToString,
  type Value,
} from "./objects.js"
import type { Interpreter } from "./interpreter.js"
import { Push } from "./signals.js"
import { withPrimitives } from "./callback.js"
import { Drain, drain } from "../machine/natives.js"
import { formatValue } from "../stdlib/console.js"

/**
 * A host error's message as text. A host can store anything there; an object must not cross as itself, and turning it
 * into text would run its own methods.
 */
export const errorMessage = (error: Error): string => {
  const message: unknown = error.message
  if (typeof message === "string") return message
  if (message === undefined || typeof message === "function" || (typeof message === "object" && message !== null)) {
    return ""
  }
  return String(message)
}

/** A host error's name as a program error type, read once so a getter cannot pass the check and then change. */
export const errorType = (error: Error): ErrorType => {
  const name: unknown = error.name
  return typeof name === "string" && isErrorType(name) ? name : "Error"
}

export const normalizeError = (error: unknown): Diagnostic => {
  if (error instanceof PendingThrow) {
    const location = error.node?.loc ? sourceLocation(error.node) : undefined
    return {
      kind: error.kind,
      message: `${error.type}: ${error.message}${formatLocation(location)}`,
      ...(location ? { location } : {}),
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
      return value.failure ? normalizeError(value.failure) : { kind: "ExecutionFailure", message: errorToString(value) }
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

  if (error instanceof RangeError && /call stack|recursion/i.test(errorMessage(error))) {
    return {
      kind: "ExecutionFailure",
      message: "Execution exceeded the maximum nesting depth.",
    }
  }

  if (error instanceof Error) {
    return {
      kind: error.name === "SyntaxError" ? "ParseError" : "ExecutionFailure",
      message: errorMessage(error),
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
    return new PendingThrow(errorType(error), errorMessage(error), node)
  }
  return error
}

/** The program value a handler receives for a failure; one failure always yields the same value. */
export const materialize = <R>(ctx: Interpreter<R>, thrown: unknown): Value => {
  if (thrown instanceof Throw) return thrown.value
  const builtins = ctx.builtins
  if (thrown instanceof PendingThrow) {
    if (thrown.value === undefined) {
      thrown.value = createErrorValue(builtins[thrown.type], thrown.message)
      thrown.value.failure = thrown
    }
    return thrown.value
  }
  return createErrorValue(
    builtins[thrown instanceof Error ? errorType(thrown) : "Error"],
    normalizeError(thrown).message,
  )
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
  errors: Array<Value>,
  message: string,
  proto: Obj = ctx.builtins.AggregateError,
) => {
  const value = createErrorValue(proto, message)
  define(value, "errors", new Arr(ctx.builtins.Array, errors), { ...hidden })
  return value
}

// State: the message, the prototype, the options, and the errors so far.
const AggregateErrors = consumer({
  name: "new AggregateError",
  notIterable: () => {
    throw typeError("new AggregateError(...) expects a synchronous iterable of errors.")
  },
  take: (frame, value) => {
    ;(frame.slots[STATE + 3] as Array<Value>).push(value)
  },
  done: (task, frame) => {
    const slots = frame.slots
    const created = createAggregateErrorValue(
      task.ctx,
      slots[STATE + 3] as Array<Value>,
      slots[STATE] as string,
      slots[STATE + 1] as Obj,
    )
    return withCause(created, slots[STATE + 2] as Value)
  },
})

// ES2022 `new Error(message, { cause })`: installed only when the options object has the property at all.
const withCause = (created: ErrorObj, options: Value) => {
  if (options instanceof Obj && has(options, "cause")) define(created, "cause", get(options, "cause"), hidden)
  return created
}

/** An error constructor such as `Error` or `TypeError`; callable with or without `new`, like JS. */
export const errorGlobal = <R>(type: ErrorType, ctx: Interpreter<R>) => {
  const builtins = ctx.builtins
  const prototype = builtins[type]
  const construct = (args: Array<Value>, newTarget: Callable) => {
    const proto = prototypeFrom(newTarget, prototype)
    if (type === "AggregateError") {
      const message = args[1]
      return withPrimitives(
        "string",
        message === undefined ? [] : [message],
        ([text]) => {
          const state = [message === undefined ? "" : coerceToString(text), proto, args[2], []]
          return new Push(Drain, drain(AggregateErrors, args[0], state))
        },
        true,
      )
    }
    const message = args[0]
    return withPrimitives(
      "string",
      message === undefined ? [] : [message],
      ([text]) => withCause(createErrorValue(proto, message === undefined ? undefined : coerceToString(text)), args[1]),
      true,
    )
  }
  const ctor: Native = constructor(builtins, prototype, {
    name: type,
    length: type === "AggregateError" ? 2 : 1,
    call: (_, args) => construct(args, ctor),
    construct,
  })
  if (type === "Error") {
    methods(builtins, prototype, [
      ["toString", 0, (thisValue) => errorToString(receiver(Obj, thisValue, "Error.prototype.toString"))],
    ])
    methods(builtins, ctor, [["isError", 1, (_, args) => args[0] instanceof ErrorObj]])
    return ctor
  }
  // Derived constructors extend Error itself, so its statics are inherited. The globals table creates Error first.
  ctor.proto = get(builtins.Error, "constructor") as Obj
  return ctor
}
