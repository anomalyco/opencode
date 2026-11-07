import type { AnyNode, BlockStatement, ModuleDeclaration, Pattern, Program, Statement } from "acorn"
import { Result } from "effect"
import type { Diagnostic } from "./codemode.js"
import { parseProgram } from "./interpreter/execute.js"
import { formatLocation } from "./interpreter/model.js"

/**
 * Extracts every `tools.<path>` referenced by a Code Mode program, in first-seen order. Fails on syntax errors,
 * dynamic bracket access (`tools[name]`), or aliasing/passing `tools` rather than calling `tools.<path>(...)` directly.
 */
export function scanTools(code: string): Result.Result<ReadonlyArray<string>, Diagnostic> {
  if (code.trim().length === 0) {
    return Result.fail({ kind: "ParseError", message: "Code cannot be empty." })
  }
  const parsed = parseProgram(code)
  if (!parsed.ok) return Result.fail(parsed.error)

  const found = new Set<string>()
  const scopes: Array<Set<string>> = [collectScope(parsed.program, true)]
  const ancestors: Array<AnyNode> = []

  const isShadowed = () => scopes.some((scope) => scope.has("tools"))

  const fail = (node: AnyNode, message: string): Diagnostic => {
    const loc = node.loc?.start ? { line: node.loc.start.line, column: node.loc.start.column + 1 } : undefined
    return {
      kind: "UnsupportedSyntax",
      message: `${message}${loc ? formatLocation(loc) : ""}`,
      ...(loc ? { location: loc } : {}),
    }
  }

  const visit = (node: AnyNode | null | undefined): Diagnostic | undefined => {
    if (!node) return undefined

    if (node.type === "Identifier" && node.name === "tools" && !isShadowed()) {
      const parent = ancestors.at(-1)
      if (!isReferencePosition(node, parent)) return undefined
      const chain = readStaticToolCall(node, ancestors)
      if (!chain.ok) return fail(chain.node, chain.reason)
      found.add(chain.path)
      return undefined
    }

    const pushedScope = enterNodeScope(node)
    if (pushedScope) scopes.push(pushedScope)
    ancestors.push(node)

    const error = visitChildren(node, visit)

    ancestors.pop()
    if (pushedScope) scopes.pop()
    return error
  }

  const diagnostic = visit(parsed.program)
  if (diagnostic) return Result.fail(diagnostic)
  return Result.succeed(Array.from(found))
}

function isReferencePosition(node: AnyNode, parent: AnyNode | undefined): boolean {
  if (!parent) return true
  if (parent.type === "MemberExpression" && parent.property === node && !parent.computed) return false
  if (parent.type === "Property" && parent.key === node && !parent.computed && !parent.shorthand) return false
  if (parent.type === "MethodDefinition" && parent.key === node && !parent.computed) return false
  if (
    (parent.type === "LabeledStatement" || parent.type === "BreakStatement" || parent.type === "ContinueStatement") &&
    parent.label === node
  ) {
    return false
  }
  if (
    (parent.type === "FunctionDeclaration" || parent.type === "FunctionExpression" || parent.type === "ClassDeclaration" || parent.type === "ClassExpression") &&
    parent.id === node
  ) {
    return false
  }
  if (parent.type === "VariableDeclarator" && parent.id === node) return false
  return true
}

function readStaticToolCall(
  root: AnyNode,
  ancestors: ReadonlyArray<AnyNode>,
): { readonly ok: true; readonly path: string } | { readonly ok: false; readonly node: AnyNode; readonly reason: string } {
  const segments: Array<string> = []
  let current = root
  let index = ancestors.length - 1

  while (index >= 0) {
    const parent = ancestors[index]!
    if (parent.type === "ChainExpression" && parent.expression === current) {
      current = parent
      index -= 1
      continue
    }
    if (parent.type !== "MemberExpression" || parent.object !== current) break
    if (!parent.computed && parent.property.type === "Identifier") {
      segments.push(parent.property.name)
      current = parent
      index -= 1
      continue
    }
    if (parent.computed && parent.property.type === "Literal" && typeof parent.property.value === "string") {
      segments.push(parent.property.value)
      current = parent
      index -= 1
      continue
    }
    return {
      ok: false,
      node: parent.property,
      reason: "Schedule checks must reference tools statically (e.g. tools.slack.read_thread), not with dynamic bracket expressions.",
    }
  }

  const callParent = index >= 0 ? ancestors[index] : undefined
  if (segments.length === 0 || callParent?.type !== "CallExpression" || callParent.callee !== current) {
    return {
      ok: false,
      node: current,
      reason: "Schedule checks must call tools directly as tools.<name>(...), not alias or pass the tools object.",
    }
  }
  return { ok: true, path: segments.join(".") }
}

function enterNodeScope(node: AnyNode): Set<string> | undefined {
  if (
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression"
  ) {
    const names = new Set<string>()
    if (node.id) names.add(node.id.name)
    for (const param of node.params) collectPattern(param, names)
    if (node.body.type === "BlockStatement") {
      for (const name of collectScope(node.body, true)) names.add(name)
    }
    return names
  }
  if (node.type === "BlockStatement") return collectScope(node, false)
  if (node.type === "CatchClause") {
    const names = new Set<string>()
    if (node.param) collectPattern(node.param, names)
    return names
  }
  if (node.type === "ForStatement" && node.init?.type === "VariableDeclaration" && node.init.kind !== "var") {
    const names = new Set<string>()
    for (const decl of node.init.declarations) collectPattern(decl.id, names)
    return names
  }
  if (
    (node.type === "ForInStatement" || node.type === "ForOfStatement") &&
    node.left.type === "VariableDeclaration" &&
    node.left.kind !== "var"
  ) {
    const names = new Set<string>()
    for (const decl of node.left.declarations) collectPattern(decl.id, names)
    return names
  }
  return undefined
}

function collectScope(container: Program | BlockStatement, includeVar: boolean): Set<string> {
  const names = new Set<string>()
  for (const statement of container.body) {
    if (statement.type === "FunctionDeclaration" && statement.id) names.add(statement.id.name)
    if (statement.type === "ClassDeclaration" && statement.id) names.add(statement.id.name)
    if (statement.type === "VariableDeclaration" && (includeVar || statement.kind !== "var")) {
      for (const decl of statement.declarations) collectPattern(decl.id, names)
    }
  }
  if (includeVar) collectNestedVars(container.body, names)
  return names
}

function collectNestedVars(statements: ReadonlyArray<Statement | ModuleDeclaration>, names: Set<string>) {
  const walkStmt = (node: AnyNode | null | undefined) => {
    if (!node) return
    if (
      node.type === "FunctionDeclaration" ||
      node.type === "FunctionExpression" ||
      node.type === "ArrowFunctionExpression"
    ) {
      return
    }
    if (node.type === "VariableDeclaration" && node.kind === "var") {
      for (const decl of node.declarations) collectPattern(decl.id, names)
    }
    visitChildren(node, (child) => {
      walkStmt(child)
      return undefined
    })
  }
  for (const stmt of statements) walkStmt(stmt)
}

function collectPattern(pattern: Pattern, names: Set<string>) {
  switch (pattern.type) {
    case "Identifier":
      names.add(pattern.name)
      return
    case "AssignmentPattern":
      collectPattern(pattern.left, names)
      return
    case "RestElement":
      collectPattern(pattern.argument, names)
      return
    case "ArrayPattern":
      for (const element of pattern.elements) if (element) collectPattern(element, names)
      return
    case "ObjectPattern":
      for (const prop of pattern.properties) {
        if (prop.type === "RestElement") collectPattern(prop.argument, names)
        if (prop.type === "Property") collectPattern(prop.value, names)
      }
      return
    case "MemberExpression":
      return
  }
}

function visitChildren(
  node: AnyNode,
  visit: (child: AnyNode | null | undefined) => Diagnostic | undefined,
): Diagnostic | undefined {
  for (const [key, value] of Object.entries(node as unknown as Record<string, unknown>)) {
    if (key === "type" || key === "start" || key === "end" || key === "loc" || key === "range") continue
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isAstNode(item)) {
          const error = visit(item)
          if (error) return error
        }
      }
      continue
    }
    if (isAstNode(value)) {
      const error = visit(value)
      if (error) return error
    }
  }
  return undefined
}

function isAstNode(value: unknown): value is AnyNode {
  return typeof value === "object" && value !== null && "type" in value && typeof value.type === "string"
}
