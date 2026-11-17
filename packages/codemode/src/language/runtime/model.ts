import type { Node } from "acorn"
import type { ErrorType } from "./intrinsics.js"
import type { ErrorObj, Value } from "./objects.js"

/**
 * A diagnostic's category: one of the language's (`ParseError`, `UnsupportedSyntax`, `InvalidDataValue`,
 * `TimeoutExceeded`, `ExecutionFailure`, `Truncated`), or one a host function gives with `Host.fail`.
 */
export type DiagnosticKind = string

/** A program's failure or warning, as plain data. */
export type Diagnostic = {
  readonly kind: DiagnosticKind
  readonly message: string
  readonly location?: { readonly line: number; readonly column: number }
  readonly suggestions?: ReadonlyArray<string>
}

/** Any parsed node; the compiler narrows on `type`, and diagnostics read `loc`. */
export type AstNode = Node

/** A global binding: globals are immutable per run, and top-level declarations are the program's own locals. */
export type Binding = { readonly value: Value }

export type GeneratorRequestKind = "next" | "return" | "throw"

export const AsyncIteratorSymbol: unique symbol = Symbol("codemode.async-iterator")
export const IteratorSymbol: unique symbol = Symbol("codemode.iterator")

export class Throw {
  constructor(readonly value: Value) {}
}

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

/**
 * A failure a host function raises with its own diagnostic `kind` and `suggestions` (see `Host.fail`). It reaches the
 * program as an Error with its message, and a result as a diagnostic of its kind.
 */
export class HostFailure extends Error {
  constructor(
    readonly kind: DiagnosticKind,
    message: string,
    readonly suggestions: ReadonlyArray<string> = [],
  ) {
    super(message)
  }
}

/**
 * A host value a restored run cannot have back: a function an extension returned, or what a host function returned,
 * which have no data form. Using it fails with `lostError`.
 */
export class Lost {
  constructor(readonly description: string) {}
}

/** What using a value lost to a suspend throws. */
export const lostError = (description: string, node?: AstNode): PendingThrow =>
  new PendingThrow(
    "TypeError",
    `${description} came from the host and was lost when the run was suspended; get it again after resuming.`,
    node,
  )

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

// Acorn lines are 1-based and its columns are 0-based. Diagnostics use 1-based columns of the submitted source.
export const sourceLocation = (node: AstNode): { readonly line: number; readonly column: number } => ({
  line: node.loc?.start.line ?? 1,
  column: (node.loc?.start.column ?? 0) + 1,
})

export const formatLocation = (location?: { readonly line: number; readonly column: number }): string =>
  location ? ` (line ${location.line}, col ${location.column})` : ""
