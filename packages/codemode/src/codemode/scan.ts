import type { AnyNode, BlockStatement, ModuleDeclaration, Pattern, Program, Statement } from "acorn"
import { Result } from "effect"
import type { Diagnostic } from "./codemode.js"
import { formatLocation, moduleName, parseProgram } from "psychoscript/effect"

/**
 * Extracts every `tools.<path>` referenced by a Code Mode program, in first-seen order. Fails on syntax errors,
 * dynamic bracket access (`tools[name]`), or aliasing/passing `tools` rather than calling `tools.<path>(...)` directly.
 */
export function scanTools(code: string): Result.Result<ReadonlyArray<string>, Diagnostic> {
  return scanProgram(code, []).pipe(Result.map((scanned) => scanned.tools))
}

interface ProgramScan {
  readonly tools: ReadonlyArray<string>
  readonly globals: ReadonlyMap<string, ReadonlyArray<GlobalUse>>
  readonly modules: ReadonlySet<string>
}

interface GlobalUse {
  readonly member?: string
  // First non-forwarding member used on a call's result. Undefined means the value escaped or was used dynamically.
  readonly resultMembers: Iterable<string | undefined>
}

/** Scans static tool calls, references to the given globals, and literal module loads. */
export function scanProgram(
  code: string,
  globals: ReadonlyArray<string>,
  forwardingMembers: ReadonlyArray<string> = [],
): Result.Result<ProgramScan, Diagnostic> {
  if (code.trim().length === 0) {
    return Result.fail({ kind: "ParseError", message: "Code cannot be empty." })
  }
  const parsed = parseProgram(code)
  // A parse failure's kind is always ParseError.
  if (!parsed.ok) return Result.fail(parsed.error as Diagnostic)

  const tools = new Set<string>()
  const referenced = new Map<string, GlobalUse[]>()
  const localUses = new Map<Set<string>, Map<string, Set<string | undefined>>>()
  const modules = new Set<string>()
  const scopes: Array<Set<string>> = [collectScope(parsed.program, true)]
  const ancestors: Array<AnyNode> = []

  // A binding may be referenced in a closure before its initializer appears in the walk.
  const bindingUses = (scope: Set<string>, name: string) => {
    const locals = localUses.get(scope) ?? new Map<string, Set<string | undefined>>()
    localUses.set(scope, locals)
    const uses = locals.get(name) ?? new Set<string | undefined>()
    locals.set(name, uses)
    return uses
  }

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

    if (
      node.type === "Identifier" &&
      (globals.length > 0 || node.name === "tools") &&
      isReferencePosition(node, ancestors.at(-1))
    ) {
      const scope = scopes.findLast((scope) => scope.has(node.name))
      if (scope && globals.length > 0)
        bindingUses(scope, node.name).add(resultMember(node, ancestors, ancestors.length - 1, forwardingMembers))

      if (!scope && node.name === "tools") {
        const chain = readStaticToolCall(node, ancestors)
        if (!chain.ok) return fail(chain.node, chain.reason)
        tools.add(chain.path)
        return undefined
      }

      if (!scope && globals.includes(node.name)) {
        const uses = referenced.get(node.name) ?? []
        referenced.set(node.name, uses)
        const property = ancestors.at(-1)
        const member =
          property?.type === "MemberExpression" && property.object === node ? memberName(property) : undefined
        const call = ancestors.at(-2)
        if (member === undefined || call?.type !== "CallExpression" || call.callee !== property) {
          uses.push({ member, resultMembers: [undefined] })
          return undefined
        }
        const result = valueUse(call, ancestors, ancestors.length - 3)
        if (result.parent?.type === "ExpressionStatement") {
          uses.push({ member, resultMembers: [] })
          return undefined
        }
        if (
          result.parent?.type === "VariableDeclarator" &&
          result.parent.init === result.value &&
          result.parent.id.type === "Identifier"
        ) {
          const name = result.parent.id.name
          const binding = scopes.findLast((scope) => scope.has(name))
          if (binding) {
            uses.push({ member, resultMembers: bindingUses(binding, name) })
            return undefined
          }
        }
        uses.push({ member, resultMembers: [resultMember(result.value, ancestors, result.index, forwardingMembers)] })
      }
    }

    // `import`/`require` of "tools" would reach tools the scan never sees.
    const loaded = loadedModule(node)
    if (loaded !== undefined) {
      const name = loaded === null ? undefined : moduleName(loaded)
      if (name === undefined || name === "tools")
        return fail(node, "Code Mode scripts must call tools directly as tools.<name>(...), not import or require them.")
      modules.add(name)
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
  return Result.succeed({ tools: [...tools], globals: referenced, modules })
}

function memberName(node: Extract<AnyNode, { type: "MemberExpression" }>) {
  if (!node.computed && node.property.type === "Identifier") return node.property.name
  if (node.computed && node.property.type === "Literal" && typeof node.property.value === "string")
    return node.property.value
}

/** Skip wrappers that leave the wrapped value available for another access. */
function valueUse(value: AnyNode, ancestors: ReadonlyArray<AnyNode>, index: number) {
  for (; index >= 0; index--) {
    const parent = ancestors[index]
    if (
      (parent.type === "AwaitExpression" && parent.argument === value) ||
      (parent.type === "ChainExpression" && parent.expression === value)
    ) {
      value = parent
      continue
    }
    return { value, parent, index }
  }
  return { value, parent: undefined, index }
}

function resultMember(
  value: AnyNode,
  ancestors: ReadonlyArray<AnyNode>,
  index: number,
  forwardingMembers: ReadonlyArray<string>,
): string | undefined {
  const use = valueUse(value, ancestors, index)
  if (use.parent?.type !== "MemberExpression" || use.parent.object !== use.value) return
  const name = memberName(use.parent)
  if (name === undefined || !forwardingMembers.includes(name)) return name
  const call = ancestors[use.index - 1]
  if (call?.type === "CallExpression" && call.callee === use.parent)
    return resultMember(call, ancestors, use.index - 2, forwardingMembers)
}

/** The module an `import` or `require(...)` loads, `null` when it is computed, or `undefined` for other nodes. */
function loadedModule(node: AnyNode): string | null | undefined {
  const specifier =
    node.type === "ImportDeclaration" || node.type === "ImportExpression"
      ? node.source
      : node.type === "CallExpression" && node.callee.type === "Identifier" && node.callee.name === "require"
        ? node.arguments[0]
        : undefined
  if (specifier === undefined) return undefined
  return specifier.type === "Literal" && typeof specifier.value === "string" ? specifier.value : null
}

function isReferencePosition(node: AnyNode, parent: AnyNode | undefined): boolean {
  if (!parent) return true
  if (
    parent.type === "ImportSpecifier" ||
    parent.type === "ImportDefaultSpecifier" ||
    parent.type === "ImportNamespaceSpecifier"
  )
    return false
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
):
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly node: AnyNode; readonly reason: string } {
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
    const member = memberName(parent)
    if (member === undefined) {
      return {
        ok: false,
        node: parent.property,
        reason:
          "Code Mode scripts must reference tools statically (e.g. tools.slack.read_thread), not with dynamic bracket expressions.",
      }
    }
    segments.push(member)
    current = parent
    index -= 1
  }

  const callParent = index >= 0 ? ancestors[index] : undefined
  if (segments.length === 0 || callParent?.type !== "CallExpression" || callParent.callee !== current) {
    return {
      ok: false,
      node: current,
      reason: "Code Mode scripts must call tools directly as tools.<name>(...), not alias or pass the tools object.",
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
    if (statement.type === "ImportDeclaration") {
      for (const specifier of statement.specifiers) names.add(specifier.local.name)
    }
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
