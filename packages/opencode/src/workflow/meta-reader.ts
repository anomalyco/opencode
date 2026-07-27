import ts from "typescript"
import { Cause, Exit, Schema } from "effect"
import { Meta } from "./meta"

// The single error text every non-literal meta value maps to. Workflow discovery
// (list/read/autocomplete/HTTP) must never EXECUTE a workflow module just to read
// its meta — doing so runs untrusted top-level code before any permission gate
// (the root cause this reader fixes). So meta is extracted purely from the AST:
// only literal values are understood. Anything dynamic (a call, an identifier, a
// member access like `process.env.X`, a template with substitutions, …) cannot
// be known without running code, so it is rejected with this message rather than
// throwing or evaluated.
const NON_LITERAL_ERROR = "workflow meta must be statically analyzable (literal values only)"

export type Result = { valid: true; meta: Meta } | { valid: false; error: string }

const decodeMeta = Schema.decodeUnknownExit(Meta)

/**
 * Statically extracts a workflow module's meta from its SOURCE TEXT, without ever
 * importing or executing the module. Supports the same module shapes the engine's
 * `loadModule` accepts at runtime:
 *   1. named exports — `export const meta = { … }` (+ `export … run`)
 *   2. a default object literal — `export default { meta: { … }, run() {} }`
 *   3. the plugin helper — `export default workflow({ name, description, … })`,
 *      where the meta fields live at the top level of the call's object argument
 *      (`run` is ignored).
 * The extracted object is validated by the SAME `Meta` schema the engine uses, so
 * a file that statically parses but is not a valid meta is reported invalid with
 * the schema's own message. Non-literal values yield `NON_LITERAL_ERROR`. Never
 * throws: every failure mode is returned as `{ valid: false, error }`.
 */
export function read(source: string, filePath: string): Result {
  const file = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true)
  // More than one `export default` is invalid TS and ambiguous to extract from —
  // reject explicitly rather than silently picking the first one.
  if (file.statements.filter((s) => ts.isExportAssignment(s) && !s.isExportEquals).length > 1)
    return { valid: false, error: "Multiple default exports; cannot determine the workflow" }
  const node = findMetaObject(file)
  if (!node) return { valid: false, error: "Missing meta export (export const meta / export default)" }
  const extracted = extractValue(node)
  if (extracted.ok === false) return { valid: false, error: NON_LITERAL_ERROR }
  const decoded = decodeMeta(extracted.value, { errors: "all", propertyOrder: "original" })
  if (Exit.isFailure(decoded)) return { valid: false, error: Cause.pretty(decoded.cause) }
  return { valid: true, meta: decoded.value }
}

// Strips the syntactic wrappers that carry no runtime value — `(expr)`,
// `expr as T` / `as const`, and `expr satisfies T` — so idiomatic TS like
// `{ … } as const` or `phases: [...] as const` is seen as the literal it wraps.
function unwrap(node: ts.Expression): ts.Expression {
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node))
    return unwrap(node.expression)
  return node
}

// Locates the object literal that carries the meta, matching the three accepted
// module shapes. Returns the ObjectLiteral whose properties ARE the meta (forms 1
// and 3 flatten to the same shape: `{ name, description, phases, arguments }`).
function findMetaObject(file: ts.SourceFile): ts.ObjectLiteralExpression | undefined {
  for (const statement of file.statements) {
    // Form 1: `export const meta = { … }` (initializer may be `… as const`).
    if (ts.isVariableStatement(statement) && hasExportModifier(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.name.text === "meta" && decl.initializer) {
          const initializer = unwrap(decl.initializer)
          return ts.isObjectLiteralExpression(initializer) ? initializer : undefined
        }
      }
    }
    // Forms 2 & 3: `export default …` (expression may be `(…)`/`… as const`).
    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      const expr = unwrap(statement.expression)
      // Form 2: a default object literal — read its `meta` property's value.
      if (ts.isObjectLiteralExpression(expr)) return metaPropertyObject(expr)
      // Form 3: `workflow({ … })` — the call's first arg is the flat meta object
      // (name/description/phases/arguments at the top level; `run` is ignored by
      // the schema, which only reads the meta keys).
      if (ts.isCallExpression(expr)) {
        const arg = expr.arguments[0]
        const unwrapped = arg ? unwrap(arg) : undefined
        return unwrapped && ts.isObjectLiteralExpression(unwrapped) ? unwrapped : undefined
      }
    }
  }
  return undefined
}

function metaPropertyObject(object: ts.ObjectLiteralExpression): ts.ObjectLiteralExpression | undefined {
  for (const property of object.properties) {
    if (ts.isPropertyAssignment(property) && propertyKey(property.name) === "meta") {
      const initializer = unwrap(property.initializer)
      return ts.isObjectLiteralExpression(initializer) ? initializer : undefined
    }
  }
  return undefined
}

function hasExportModifier(node: ts.HasModifiers) {
  return node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false
}

function propertyKey(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text
  return undefined
}

type Extracted = { ok: true; value: unknown } | { ok: false }

const FAIL: Extracted = { ok: false }

function isFunctionLike(node: ts.Expression) {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node)
}

// Recursively converts a literal AST node into its plain JS value. Anything that
// would require executing code to know its value (identifiers, calls, member
// access, spreads, methods, computed keys, template substitutions) makes the
// whole extraction fail — the caller turns that into the NON_LITERAL_ERROR.
function extractValue(input: ts.Expression): Extracted {
  // Transparent wrappers (`(expr)`, `as const`, `satisfies`) carry no value.
  const node = unwrap(input)
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return { ok: true, value: node.text }
  if (ts.isNumericLiteral(node)) return { ok: true, value: Number(node.text) }
  if (node.kind === ts.SyntaxKind.TrueKeyword) return { ok: true, value: true }
  if (node.kind === ts.SyntaxKind.FalseKeyword) return { ok: true, value: false }
  if (node.kind === ts.SyntaxKind.NullKeyword) return { ok: true, value: null }
  // Negative (and explicit positive) numeric literals: `-3`, `+1`.
  if (ts.isPrefixUnaryExpression(node) && ts.isNumericLiteral(node.operand)) {
    if (node.operator === ts.SyntaxKind.MinusToken) return { ok: true, value: -Number(node.operand.text) }
    if (node.operator === ts.SyntaxKind.PlusToken) return { ok: true, value: Number(node.operand.text) }
    return FAIL
  }
  if (ts.isArrayLiteralExpression(node)) {
    const items: unknown[] = []
    for (const element of node.elements) {
      const extracted = extractValue(element)
      if (extracted.ok === false) return FAIL
      items.push(extracted.value)
    }
    return { ok: true, value: items }
  }
  if (ts.isObjectLiteralExpression(node)) {
    const result: Record<string, unknown> = {}
    for (const property of node.properties) {
      // Method members (e.g. the `run(args, ctx) {}` carried by the `workflow({…})`
      // helper form) are functions, never part of literal meta, and are ignored by
      // the Meta schema — skip them rather than fail the whole extraction.
      if (ts.isMethodDeclaration(property)) continue
      if (!ts.isPropertyAssignment(property)) return FAIL
      const key = propertyKey(property.name)
      if (key === undefined) return FAIL
      // A `run:` value that is itself a function is likewise ignored, not literal.
      if (key === "run" && isFunctionLike(unwrap(property.initializer))) continue
      const extracted = extractValue(property.initializer)
      if (extracted.ok === false) return FAIL
      result[key] = extracted.value
    }
    return { ok: true, value: result }
  }
  return FAIL
}

export * as MetaReader from "./meta-reader"
