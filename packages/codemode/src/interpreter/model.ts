import type { Node } from "acorn"
import { Context } from "effect"
import type { ErrorType } from "./intrinsics.js"
import type { DiagnosticKind } from "../codemode.js"
import type { ErrorObj, Value } from "./objects.js"

/** Any parsed node; the interpreter narrows on `type` and reads `loc` for diagnostics. */
export type AstNode = Node

/**
 * The program call a built-in is running under: where to locate failures born inside it, how deep the stack is there,
 * and how many built-ins have invoked one another since program code last called one.
 */
export const CallSite = Context.Reference<{
  readonly node?: AstNode
  readonly depth: number
  readonly natives: number
}>("codemode/CallSite", { defaultValue: () => ({ depth: 0, natives: 0 }) })

export type Binding = {
  mutable: boolean
  value: Value
  initialized?: boolean
}

export type StatementResult =
  | { kind: "none" }
  | { kind: "return"; value: Value }
  | { kind: "break"; label?: string }
  | { kind: "continue"; label?: string }

export type GeneratorRequestKind = "next" | "return" | "throw"

export const AsyncIteratorSymbol: unique symbol = Symbol("codemode.async-iterator")
export const IteratorSymbol: unique symbol = Symbol("codemode.iterator")
export const IteratorSymbols = [AsyncIteratorSymbol, IteratorSymbol] as const

export class Throw {
  constructor(readonly value: Value) {}
}

export class GeneratorReturn {
  constructor(readonly value: Value) {}
}

export const OptionalShortCircuit: unique symbol = Symbol("codemode.optional-short-circuit")

/**
 * A failure raised by the interpreter or a built-in. It travels as a defect and becomes one program Error object
 * the first time a handler observes it, so every observer of the same failure sees the same value.
 */
export class PendingThrow {
  node?: AstNode
  value?: ErrorObj

  constructor(
    /** The JS error class a program sees when it catches this failure. */
    readonly type: ErrorType,
    readonly message: string,
    node?: AstNode,
    readonly kind: DiagnosticKind = "ExecutionFailure",
    readonly suggestions?: ReadonlyArray<string>,
  ) {
    if (node) this.node = node
  }
}

const failure = (type: ErrorType, kind?: DiagnosticKind) => (message: string, node?: AstNode) =>
  new PendingThrow(type, message, node, kind)

export const typeError = failure("TypeError")
export const invalidData = failure("TypeError", "InvalidDataValue")
export const rangeError = failure("RangeError")
export const referenceError = failure("ReferenceError")
export const syntaxError = failure("SyntaxError")
export const uriError = failure("URIError")

// Orient the agent rather than enumerate JavaScript; interpreter-support.md is the full matrix.
export const supportedSyntaxMessage =
  "This is a restricted JavaScript-like language. Supported: plain and async functions, data literals, destructuring, standard control flow, await and Promise, and built-ins such as Array, Object, Math, JSON, Date, RegExp, Map, Set, and URL. Unsupported: classes, getters/setters, BigInt, and custom Symbols. Use plain functions and data objects instead."

export const unsupportedSyntax = (kind: string, node: AstNode): PendingThrow =>
  new PendingThrow(
    "SyntaxError",
    `Syntax '${kind}' is not supported. ${supportedSyntaxMessage}`,
    node,
    "UnsupportedSyntax",
    [supportedSyntaxMessage],
  )

// Acorn lines are 1-based and its columns are 0-based. Diagnostics use 1-based columns of the submitted source.
export const sourceLocation = (node: AstNode): { readonly line: number; readonly column: number } => ({
  line: node.loc?.start.line ?? 1,
  column: (node.loc?.start.column ?? 0) + 1,
})

export const formatLocation = (node?: AstNode): string => {
  if (!node?.loc) return ""
  const location = sourceLocation(node)
  return ` (line ${location.line}, col ${location.column})`
}
