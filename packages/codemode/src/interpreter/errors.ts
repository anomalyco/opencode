import { Effect } from "effect"
import type { Diagnostic } from "../codemode.js"
import { ToolError } from "../tool-error.js"
import { toData, ToolRuntimeError } from "../data.js"
import { type AstNode, formatLocation, InterpreterRuntimeError, ProgramThrow, sourceLocation } from "./model.js"
import { containsRuntimeReference } from "./references.js"
import { type HostCall, HostFunction } from "./host.js"
import { createErrorValue, type ErrorType, isErrorType } from "./intrinsics.js"
import { get, hasPrototype, ProgramArray, ProgramError, ProgramObject, set } from "./objects.js"
import { type Runner } from "./runner.js"
import { coerceToString } from "../stdlib/value.js"

export const normalizeError = (error: unknown): Diagnostic => {
  if (error instanceof InterpreterRuntimeError) {
    return {
      kind: error.kind,
      message: `${error.message}${formatLocation(error.node)}`,
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

  if (error instanceof ProgramThrow) {
    const value = error.value
    let message: string
    if (containsRuntimeReference(value)) {
      // Never expose runtime reference internals through thrown values.
      message = "a non-data value"
    } else if (typeof value === "string") {
      message = value
    } else if (value instanceof ProgramObject && typeof get(value, "message") === "string") {
      message = get(value, "message") as string
    } else {
      try {
        message = JSON.stringify(toData(value, "Thrown value")) ?? String(value)
      } catch {
        message = String(value)
      }
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

export const caughtErrorValue = <R>(runner: Runner<R>, thrown: unknown): unknown => {
  if (thrown instanceof ProgramThrow) return thrown.value
  const prototypes = runner.intrinsics.errors
  if (thrown instanceof InterpreterRuntimeError) return createErrorValue(prototypes[thrown.type], thrown.message)
  const type = thrown instanceof Error && isErrorType(thrown.name) ? thrown.name : "Error"
  return createErrorValue(prototypes[type], normalizeError(thrown).message)
}

export const createAggregateErrorValue = <R>(runner: Runner<R>, errors: Array<unknown>, message: string) => {
  const value = createErrorValue(runner.intrinsics.errors.AggregateError, message)
  set(value, "errors", new ProgramArray(errors))
  return value
}

const constructAggregateErrorValue = <R>(
  runner: Runner<R>,
  args: Array<unknown>,
  node: AstNode,
): Effect.Effect<ProgramError, unknown, R> =>
  Effect.gen(function* () {
    const cursor = yield* runner.syncIterator(args[0], node)
    if (cursor === undefined) {
      throw new InterpreterRuntimeError("new AggregateError(...) expects a synchronous iterable of errors.", node)
    }
    const errors: Array<unknown> = []
    while (true) {
      const step = yield* cursor.next
      if (step.done) {
        return createAggregateErrorValue(runner, errors, args[1] === undefined ? "" : coerceToString(args[1]))
      }
      errors.push(step.value)
    }
  })

/** An error constructor such as `Error` or `TypeError`; callable with or without `new`, like JS. */
export const errorGlobal = <R>(type: ErrorType, runner: Runner<R>) => {
  const prototype = runner.intrinsics.errors[type]
  const construct: HostCall<R> = (args, node) =>
    type === "AggregateError"
      ? constructAggregateErrorValue(runner, args, node)
      : Effect.sync(() => createErrorValue(prototype, args[0] === undefined ? undefined : coerceToString(args[0])))
  const fn = new HostFunction<R>({
    name: type,
    call: construct,
    construct,
    instanceOf: (value) => hasPrototype(value, prototype),
  })
  set(prototype, "constructor", fn)
  return fn
}
