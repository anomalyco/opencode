import type { Diagnostic } from "../codemode.js"
import { ToolError } from "../tool-error.js"
import { copyOut, ToolRuntimeError, type SafeObject } from "../tool-runtime.js"
import { type AstNode, formatLocation, InterpreterRuntimeError, ProgramThrow, sourceLocation } from "./model.js"
import { containsRuntimeReference } from "./references.js"
import { spreadItems } from "../stdlib/collections.js"
import { coerceToString, createAggregateErrorValue, createErrorValue, errorConstructors } from "../stdlib/value.js"

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
    } else if (
      value !== null &&
      typeof value === "object" &&
      typeof (value as { message?: unknown }).message === "string"
    ) {
      message = (value as { message: string }).message
    } else {
      try {
        message = JSON.stringify(copyOut(value)) ?? String(value)
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

export const caughtErrorValue = (thrown: unknown): unknown => {
  if (thrown instanceof ProgramThrow) return thrown.value
  if (thrown instanceof InterpreterRuntimeError) return createErrorValue(thrown.errorName, thrown.message)
  const name = thrown instanceof Error && errorConstructors.has(thrown.name) ? thrown.name : "Error"
  return createErrorValue(name, normalizeError(thrown).message)
}

export const constructErrorValue = (name: string, args: Array<unknown>, node: AstNode): SafeObject => {
  if (name !== "AggregateError") return createErrorValue(name, args[0] === undefined ? "" : coerceToString(args[0]))
  const errors = spreadItems(args[0])
  if (errors === undefined) {
    throw new InterpreterRuntimeError(
      "new AggregateError(...) expects an array of errors (e.g. new AggregateError(errors, message?)).",
      node,
    ).as("TypeError")
  }
  // Error values must not alias caller-owned arrays.
  return createAggregateErrorValue([...errors], args[1] === undefined ? "" : coerceToString(args[1]))
}
