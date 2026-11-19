import type {
  AnyNode,
  ArrowFunctionExpression,
  BlockStatement,
  CatchClause,
  ClassDeclaration,
  ClassExpression,
  Expression,
  FunctionDeclaration,
  FunctionExpression,
  Identifier,
  ModuleDeclaration,
  Pattern,
  PrivateIdentifier,
  Program,
  PropertyDefinition,
  Statement,
  VariableDeclaration,
} from "acorn"
import type { Source } from "../runtime/source.js"
import { CodeFlags } from "../opcodes.js"

type FunctionNode = Program | FunctionDeclaration | FunctionExpression | ArrowFunctionExpression

type DeclKind = "var" | "let" | "const" | "function" | "param" | "catch" | "import" | "self" | "this" | "arguments" | "home" | "newTarget"

export type Decl = {
  readonly name: string
  readonly kind: DeclKind
  readonly fnIndex: number
  mutable: boolean
  captured: boolean
  used: boolean
  slot: number
  /** When a body `var` shares a name with a parameter or `arguments` in a separate `paramScope`. */
  copyFromParam?: Decl | undefined
}

export class Scope {
  readonly decls = new Map<string, Decl>()
  readonly hoistedFunctions: Array<{ readonly node: FunctionDeclaration; fnIndex: number; readonly decl: Decl }> = []

  constructor(readonly parent: Scope | undefined) {}
}

type UpvalueInfo = {
  /** `0` = parent's local cell slot, `1` = parent's upvalue index. */
  readonly from: 0 | 1
  index: number
  readonly decl: Decl
}

export type FunctionInfo = {
  readonly index: number
  readonly node: FunctionNode
  readonly parentIndex: number
  readonly name: string
  flags: number
  readonly length: number
  readonly params: ReadonlyArray<Pattern>
  readonly selfScope: Scope | undefined
  readonly paramScope: Scope
  readonly bodyScope: Scope
  readonly allDecls: Array<Decl>
  readonly upvalues: Array<UpvalueInfo>
  readonly upvalueMap: Map<Decl, number>
  thisDecl: Decl | undefined
  /** A method's home object (`super`), when it or an arrow in it uses `super`. */
  homeDecl: Decl | undefined
  /** A derived constructor's new target, which `super()` passes on. */
  newTargetDecl: Decl | undefined
  argumentsDecl: Decl | undefined
  locals: number
  readonly localNames: Array<string>
}

export type ResolvedRef =
  | { readonly kind: "local"; readonly decl: Decl }
  | { readonly kind: "upval"; readonly upvalIndex: number; readonly decl: Decl }
  | { readonly kind: "global"; readonly name: string }

export type ScopeAnalysis = {
  readonly functions: ReadonlyArray<FunctionInfo>
  readonly nodeToFunction: ReadonlyMap<FunctionNode, FunctionInfo>
  readonly scopeOfNode: ReadonlyMap<AnyNode, Scope>
  readonly refs: ReadonlyMap<Identifier, ResolvedRef>
  readonly thisRefs: ReadonlyMap<AnyNode, ResolvedRef>
  /** Each `super` of a `super.x`: its home object and `this`. Missing when it is outside a class method. */
  readonly superRefs: ReadonlyMap<AnyNode, { readonly home: ResolvedRef; readonly self: ResolvedRef }>
  /** Each class's constructor: its own, or a synthetic empty one when it has none. */
  readonly classConstructors: ReadonlyMap<ClassNode, FunctionExpression>
  /** Each class's synthetic field-initializer functions, when it has instance or static fields. */
  readonly classFieldInits: ReadonlyMap<ClassNode, { instance?: FunctionExpression; static?: FunctionExpression }>
  /** The fields a synthetic field-initializer function defines, in order. */
  readonly fieldInitMembers: ReadonlyMap<FunctionNode, ReadonlyArray<PropertyDefinition>>
  /** A computed field's key, evaluated once at class definition into a hidden class-scope binding read by this name. */
  readonly fieldKeys: ReadonlyMap<PropertyDefinition, Identifier>
}

export type ClassNode = ClassDeclaration | ClassExpression

/** The class elements compiled so far: methods, accessors and fields with plain or computed names. Anything else is refused. */
export const supportedClassMember = (member: ClassNode["body"]["body"][number]): boolean =>
  (member.type === "PropertyDefinition" || member.type === "MethodDefinition") &&
  (member.computed || plainKey(member.key))

const plainKey = (key: Expression | PrivateIdentifier): boolean =>
  key.type === "Identifier" ||
  (key.type === "Literal" && (typeof key.value === "string" || typeof key.value === "number"))

/**
 * Pass 1: walks the AST to build lexical/var scopes, assign pre-order function indices,
 * resolve all identifier and `this` references, mark captured bindings, and assign local/upvalue slots.
 */
export const analyzeScopes = (source: Source, internal = false): ScopeAnalysis => {
  const functions: Array<FunctionInfo> = []
  const nodeToFunction = new Map<FunctionNode, FunctionInfo>()
  const scopeOfNode = new Map<AnyNode, Scope>()
  const classConstructors = new Map<ClassNode, FunctionExpression>()
  const classFieldInits = new Map<ClassNode, { instance?: FunctionExpression; static?: FunctionExpression }>()
  const fieldInitMembers = new Map<FunctionNode, ReadonlyArray<PropertyDefinition>>()
  const fieldKeys = new Map<PropertyDefinition, Identifier>()
  const supers: Array<{ readonly node: AnyNode; readonly scope: Scope; readonly fnIndex: number }> = []
  const unresolved: Array<{ readonly node: AnyNode; readonly name: string; readonly scope: Scope; fnIndex: number }> =
    []

  const addDecl = (scope: Scope, fnInfo: FunctionInfo, name: string, kind: DeclKind, mutable: boolean): Decl => {
    const existing = scope.decls.get(name)
    if (existing !== undefined) {
      if (mutable) existing.mutable = true
      return existing
    }
    const decl: Decl = { name, kind, fnIndex: fnInfo.index, mutable, captured: false, used: false, slot: -1 }
    scope.decls.set(name, decl)
    fnInfo.allDecls.push(decl)
    return decl
  }

  const declareLexical = (node: VariableDeclaration, scope: Scope, fnInfo: FunctionInfo): void => {
    if (node.kind === "var") return
    for (const d of node.declarations) {
      for (const name of collectPatternNames(d.id))
        addDecl(scope, fnInfo, name, node.kind === "let" ? "let" : "const", node.kind === "let")
    }
  }

  const visitFunction = (
    node: FunctionNode,
    parentScope: Scope | undefined,
    parentFnIndex: number,
    className?: string,
  ): FunctionInfo => {
    const index = functions.length
    const isProgram = node.type === "Program"
    const isArrow = node.type === "ArrowFunctionExpression"
    const params: ReadonlyArray<Pattern> = isProgram ? [] : node.params
    const simple = params.every((p) => p.type === "Identifier")

    let flags = 0
    if (isArrow) flags |= CodeFlags.ARROW
    if (isProgram || node.async) flags |= CodeFlags.ASYNC
    if (!isProgram && node.generator) flags |= CodeFlags.GENERATOR
    if (simple) flags |= CodeFlags.SIMPLE_PARAMS
    if (internal) flags |= CodeFlags.INTERNAL
    if (isProgram) flags |= CodeFlags.PROGRAM

    const selfScope = node.type === "FunctionExpression" && node.id ? new Scope(parentScope) : undefined
    const paramScope = new Scope(selfScope ?? parentScope)
    const bodyScope = simple ? paramScope : new Scope(paramScope)
    const lengthEnd = params.findIndex((p) => p.type === "AssignmentPattern" || p.type === "RestElement")

    const fnInfo: FunctionInfo = {
      index,
      node,
      parentIndex: parentFnIndex,
      name: isProgram ? "<program>" : isArrow ? "" : (className ?? node.id?.name ?? ""),
      flags,
      length: lengthEnd === -1 ? params.length : lengthEnd,
      params,
      selfScope,
      paramScope,
      bodyScope,
      allDecls: [],
      upvalues: [],
      upvalueMap: new Map(),
      thisDecl: undefined,
      homeDecl: undefined,
      newTargetDecl: undefined,
      argumentsDecl: undefined,
      locals: 0,
      localNames: [],
    }
    functions.push(fnInfo)
    nodeToFunction.set(node, fnInfo)
    scopeOfNode.set(node, bodyScope)

    if (selfScope && node.type === "FunctionExpression") addDecl(selfScope, fnInfo, node.id!.name, "self", false)
    if (!isArrow) fnInfo.thisDecl = addDecl(paramScope, fnInfo, "this", "this", false)
    const paramNames = params.flatMap((param) => collectPatternNames(param))
    if (!isProgram && !isArrow && !paramNames.includes("arguments")) {
      fnInfo.argumentsDecl = addDecl(paramScope, fnInfo, "arguments", "arguments", true)
    }
    for (const name of paramNames) addDecl(paramScope, fnInfo, name, "param", true)
    for (const param of params) visitPattern(param, paramScope, fnInfo)

    if (node.type !== "Program" && node.body.type !== "BlockStatement") visitExpression(node.body, bodyScope, fnInfo)
    else {
      if (node.type !== "Program") scopeOfNode.set(node.body, bodyScope)
      const stmts = node.type === "Program" ? node.body : (node.body as BlockStatement).body
      hoistStatementList(stmts, bodyScope, bodyScope, fnInfo, isProgram)
      for (const stmt of stmts) visitStatement(stmt, bodyScope, bodyScope, fnInfo)
    }

    if (!simple) {
      for (const [varName, decl] of bodyScope.decls) {
        const paramDecl = decl.kind === "var" ? paramScope.decls.get(varName) : undefined
        if (paramDecl?.kind !== "param" && paramDecl?.kind !== "arguments") continue
        decl.copyFromParam = paramDecl
        paramDecl.used = true
        if (paramDecl.kind === "arguments") fnInfo.flags |= CodeFlags.USES_ARGUMENTS | CodeFlags.NEEDS_ARGS
      }
    }
    return fnInfo
  }

  const hoistStatementList = (
    stmts: ReadonlyArray<Statement | ModuleDeclaration>,
    lexicalScope: Scope,
    varScope: Scope,
    fnInfo: FunctionInfo,
    isProgram: boolean,
  ): void => {
    if (isProgram) {
      for (const stmt of stmts) {
        if (stmt.type !== "ImportDeclaration") continue
        for (const spec of stmt.specifiers) addDecl(lexicalScope, fnInfo, spec.local.name, "import", false)
      }
    }
    for (const stmt of stmts) if (stmt.type === "VariableDeclaration") declareLexical(stmt, lexicalScope, fnInfo)
    for (const stmt of stmts)
      if (stmt.type === "ClassDeclaration" && stmt.id) addDecl(lexicalScope, fnInfo, stmt.id.name, "let", true)
    for (const stmt of stmts) {
      if (stmt.type !== "FunctionDeclaration" || !stmt.id || (internal && isProgram)) continue
      const decl = addDecl(lexicalScope, fnInfo, stmt.id.name, "function", true)
      lexicalScope.hoistedFunctions.push({ node: stmt, fnIndex: -1, decl })
    }
    if (lexicalScope === varScope) for (const stmt of stmts) collectVars(stmt, varScope, fnInfo)
  }

  const collectVars = (
    stmt: Statement | ModuleDeclaration | null | undefined,
    varScope: Scope,
    fnInfo: FunctionInfo,
  ) => {
    switch (stmt?.type) {
      case "VariableDeclaration":
        if (stmt.kind !== "var") break
        for (const d of stmt.declarations) {
          for (const name of collectPatternNames(d.id)) {
            if (!varScope.decls.has(name)) addDecl(varScope, fnInfo, name, "var", true)
          }
        }
        break
      case "BlockStatement":
        for (const s of stmt.body) collectVars(s, varScope, fnInfo)
        break
      case "IfStatement":
        collectVars(stmt.consequent, varScope, fnInfo)
        collectVars(stmt.alternate, varScope, fnInfo)
        break
      case "WhileStatement":
      case "DoWhileStatement":
      case "LabeledStatement":
        collectVars(stmt.body, varScope, fnInfo)
        break
      case "ForStatement":
        if (stmt.init?.type === "VariableDeclaration") collectVars(stmt.init, varScope, fnInfo)
        collectVars(stmt.body, varScope, fnInfo)
        break
      case "ForInStatement":
      case "ForOfStatement":
        if (stmt.left.type === "VariableDeclaration") collectVars(stmt.left, varScope, fnInfo)
        collectVars(stmt.body, varScope, fnInfo)
        break
      case "SwitchStatement":
        for (const c of stmt.cases) for (const s of c.consequent) collectVars(s, varScope, fnInfo)
        break
      case "TryStatement":
        collectVars(stmt.block, varScope, fnInfo)
        collectVars(stmt.handler?.body, varScope, fnInfo)
        collectVars(stmt.finalizer, varScope, fnInfo)
        break
    }
  }

  const visitStatement = (
    stmt: Statement | ModuleDeclaration,
    scope: Scope,
    varScope: Scope,
    fnInfo: FunctionInfo,
  ): void => {
    switch (stmt.type) {
      case "ExpressionStatement":
        visitExpression(stmt.expression, scope, fnInfo)
        break
      case "VariableDeclaration":
        for (const d of stmt.declarations) {
          visitPattern(d.id, scope, fnInfo)
          if (d.init) visitExpression(d.init, scope, fnInfo)
        }
        break
      case "ReturnStatement":
      case "ThrowStatement":
        if (stmt.argument) visitExpression(stmt.argument, scope, fnInfo)
        break
      case "BlockStatement":
        visitBlock(stmt, new Scope(scope), varScope, fnInfo)
        break
      case "IfStatement":
        visitExpression(stmt.test, scope, fnInfo)
        visitStatement(stmt.consequent, scope, varScope, fnInfo)
        if (stmt.alternate) visitStatement(stmt.alternate, scope, varScope, fnInfo)
        break
      case "WhileStatement":
      case "DoWhileStatement":
        visitExpression(stmt.test, scope, fnInfo)
        visitStatement(stmt.body, scope, varScope, fnInfo)
        break
      case "ForStatement": {
        const forScope = new Scope(scope)
        scopeOfNode.set(stmt, forScope)
        if (stmt.init?.type === "VariableDeclaration") {
          declareLexical(stmt.init, forScope, fnInfo)
          visitStatement(stmt.init, forScope, varScope, fnInfo)
        } else if (stmt.init) visitExpression(stmt.init, forScope, fnInfo)
        if (stmt.test) visitExpression(stmt.test, forScope, fnInfo)
        if (stmt.update) visitExpression(stmt.update, forScope, fnInfo)
        visitStatement(stmt.body, forScope, varScope, fnInfo)
        break
      }
      case "ForInStatement":
      case "ForOfStatement": {
        const forScope = new Scope(scope)
        scopeOfNode.set(stmt, forScope)
        if (stmt.left.type === "VariableDeclaration") {
          declareLexical(stmt.left, forScope, fnInfo)
          for (const d of stmt.left.declarations) visitPattern(d.id, forScope, fnInfo)
        } else visitPattern(stmt.left, forScope, fnInfo)
        visitExpression(stmt.right, forScope, fnInfo)
        visitStatement(stmt.body, forScope, varScope, fnInfo)
        break
      }
      case "SwitchStatement": {
        visitExpression(stmt.discriminant, scope, fnInfo)
        const switchScope = new Scope(scope)
        scopeOfNode.set(stmt, switchScope)
        hoistStatementList(
          stmt.cases.flatMap((c) => c.consequent),
          switchScope,
          varScope,
          fnInfo,
          false,
        )
        for (const c of stmt.cases) {
          if (c.test) visitExpression(c.test, switchScope, fnInfo)
          for (const s of c.consequent) visitStatement(s, switchScope, varScope, fnInfo)
        }
        break
      }
      case "LabeledStatement":
        visitStatement(stmt.body, scope, varScope, fnInfo)
        break
      case "TryStatement":
        visitBlock(stmt.block, new Scope(scope), varScope, fnInfo)
        if (stmt.handler) visitCatchClause(stmt.handler, scope, varScope, fnInfo)
        if (stmt.finalizer) visitBlock(stmt.finalizer, new Scope(scope), varScope, fnInfo)
        break
      case "ClassDeclaration":
        visitClass(stmt, scope, fnInfo)
        break
      case "FunctionDeclaration": {
        const childFn = visitFunction(stmt, scope, fnInfo.index)
        const hoisted = scope.hoistedFunctions.find((h) => h.node === stmt)
        if (hoisted) hoisted.fnIndex = childFn.index
        break
      }
    }
  }

  const visitBlock = (block: BlockStatement, blockScope: Scope, varScope: Scope, fnInfo: FunctionInfo): void => {
    scopeOfNode.set(block, blockScope)
    hoistStatementList(block.body, blockScope, varScope, fnInfo, false)
    for (const s of block.body) visitStatement(s, blockScope, varScope, fnInfo)
  }

  const visitCatchClause = (handler: CatchClause, scope: Scope, varScope: Scope, fnInfo: FunctionInfo): void => {
    const catchScope = new Scope(scope)
    scopeOfNode.set(handler, catchScope)
    if (handler.param) {
      for (const name of collectPatternNames(handler.param)) addDecl(catchScope, fnInfo, name, "catch", true)
      visitPattern(handler.param, catchScope, fnInfo)
    }
    visitBlock(handler.body, new Scope(catchScope), varScope, fnInfo)
  }

  const visitPattern = (pattern: Pattern, scope: Scope, fnInfo: FunctionInfo): void => {
    switch (pattern.type) {
      case "Identifier":
        unresolved.push({ node: pattern, name: pattern.name, scope, fnIndex: fnInfo.index })
        break
      case "AssignmentPattern":
        visitPattern(pattern.left, scope, fnInfo)
        visitExpression(pattern.right, scope, fnInfo)
        break
      case "RestElement":
        visitPattern(pattern.argument, scope, fnInfo)
        break
      case "ArrayPattern":
        for (const el of pattern.elements) if (el) visitPattern(el, scope, fnInfo)
        break
      case "ObjectPattern":
        for (const prop of pattern.properties) {
          if (prop.type === "RestElement") visitPattern(prop.argument, scope, fnInfo)
          else {
            if (prop.computed) visitExpression(prop.key as Expression, scope, fnInfo)
            visitPattern(prop.value, scope, fnInfo)
          }
        }
        break
      case "MemberExpression":
        visitExpression(pattern, scope, fnInfo)
        break
    }
  }

  const visitExpression = (expr: Expression | AnyNode, scope: Scope, fnInfo: FunctionInfo): void => {
    const visit = (child: Expression | AnyNode) => visitExpression(child, scope, fnInfo)
    switch (expr.type) {
      case "Identifier":
        unresolved.push({ node: expr, name: expr.name, scope, fnIndex: fnInfo.index })
        break
      case "ThisExpression":
        unresolved.push({ node: expr, name: "this", scope, fnIndex: fnInfo.index })
        break
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        visitFunction(expr, scope, fnInfo.index)
        break
      case "ClassExpression":
        visitClass(expr, scope, fnInfo)
        break
      case "BinaryExpression":
      case "LogicalExpression":
        visit(expr.left)
        visit(expr.right)
        break
      case "UnaryExpression":
      case "UpdateExpression":
      case "AwaitExpression":
      case "SpreadElement":
        visit(expr.argument)
        break
      case "YieldExpression":
        if (expr.argument) visit(expr.argument)
        break
      case "AssignmentExpression":
        visitPattern(expr.left, scope, fnInfo)
        visit(expr.right)
        break
      case "SequenceExpression":
      case "TemplateLiteral":
        for (const e of expr.expressions) visit(e)
        break
      case "ConditionalExpression":
        visit(expr.test)
        visit(expr.consequent)
        visit(expr.alternate)
        break
      case "CallExpression":
      case "NewExpression":
        if (expr.callee.type !== "Super") visit(expr.callee)
        for (const arg of expr.arguments) visit(arg)
        break
      case "MemberExpression":
        if (expr.object.type !== "Super") visit(expr.object)
        else supers.push({ node: expr.object, scope, fnIndex: fnInfo.index })
        if (expr.computed) visit(expr.property)
        break
      case "ChainExpression":
        visit(expr.expression)
        break
      case "ArrayExpression":
        for (const el of expr.elements) if (el) visit(el)
        break
      case "ObjectExpression":
        for (const prop of expr.properties) {
          if (prop.type === "SpreadElement") visit(prop.argument)
          else {
            if (prop.computed) visit(prop.key)
            visit(prop.value)
            // Object literal methods and accessors have the object as their home, for `super`.
            if (prop.method || prop.kind !== "init") nodeToFunction.get(prop.value as FunctionExpression)!.flags |= CodeFlags.METHOD
          }
        }
        break
      case "TaggedTemplateExpression":
        visit(expr.tag)
        for (const e of expr.quasi.expressions) visit(e)
        break
      case "ImportExpression":
        visit(expr.source)
        if (expr.options) visit(expr.options)
        break
    }
  }

  // The class body sees its own name as an immutable binding; the constructor and methods are functions in it.
  function visitClass(node: ClassNode, scope: Scope, fnInfo: FunctionInfo): void {
    if (!node.body.body.every(supportedClassMember)) return
    const classScope = new Scope(scope)
    scopeOfNode.set(node, classScope)
    if (node.id) addDecl(classScope, fnInfo, node.id.name, "const", false)
    if (node.superClass) visitExpression(node.superClass, classScope, fnInfo)
    const methods = node.body.body.filter((m) => m.type === "MethodDefinition")
    const ctor = methods.find((m) => m.kind === "constructor")?.value ?? defaultConstructor(node)
    classConstructors.set(node, ctor)
    const ctorInfo = visitFunction(ctor, classScope, fnInfo.index, node.id?.name ?? "")
    ctorInfo.flags |= CodeFlags.CLASS_CONSTRUCTOR | CodeFlags.METHOD
    if (node.superClass) {
      // `this` starts uninitialized: `super()` binds it, and the return rules read it.
      ctorInfo.flags |= CodeFlags.DERIVED
      ctorInfo.thisDecl!.used = true
      ctorInfo.newTargetDecl = addDecl(ctorInfo.paramScope, ctorInfo, "%newTarget", "newTarget", false)
      ctorInfo.newTargetDecl.used = true
    }
    for (const m of node.body.body) {
      if ((m.type !== "MethodDefinition" && m.type !== "PropertyDefinition") || !m.computed) continue
      visitExpression(m.key as Expression, classScope, fnInfo)
      if (m.type !== "PropertyDefinition") continue
      const name = `%key${fieldKeys.size}`
      addDecl(classScope, fnInfo, name, "const", false)
      fieldKeys.set(m, { type: "Identifier", name, start: m.key.start, end: m.key.end } as Identifier)
    }
    for (const m of methods) {
      if (m.kind === "constructor") continue
      visitFunction(m.value, classScope, fnInfo.index).flags |= CodeFlags.METHOD
    }
    const fields = node.body.body.filter((m) => m.type === "PropertyDefinition")
    const instance = fieldInit(
      node,
      classScope,
      fnInfo,
      "<instance_members_initializer>",
      fields.filter((f) => !f.static),
    )
    const statics = fieldInit(
      node,
      classScope,
      fnInfo,
      "<static_initializer>",
      fields.filter((f) => f.static),
    )
    if (instance || statics) classFieldInits.set(node, { instance, static: statics })
  }

  // `constructor() {}`, or `constructor(...args) { super(...args) }` for a derived class.
  function defaultConstructor(node: ClassNode): FunctionExpression {
    const at = { start: node.start, end: node.end }
    const args = { type: "Identifier", name: "args", ...at }
    const superCall = {
      type: "ExpressionStatement",
      expression: {
        type: "CallExpression",
        callee: { type: "Super", ...at },
        arguments: [{ type: "SpreadElement", argument: args, ...at }],
        optional: false,
        ...at,
      },
      ...at,
    }
    return {
      type: "FunctionExpression",
      id: null,
      params: node.superClass ? [{ type: "RestElement", argument: { ...args }, ...at }] : [],
      body: { type: "BlockStatement", body: node.superClass ? [superCall] : [], ...at },
      generator: false,
      expression: false,
      async: false,
      ...at,
    } as FunctionExpression
  }

  // A synthetic method whose body is `this` and the field initializers: the compiler defines each field on `this`.
  function fieldInit(
    node: ClassNode,
    classScope: Scope,
    fnInfo: FunctionInfo,
    name: string,
    fields: Array<PropertyDefinition>,
  ): FunctionExpression | undefined {
    if (fields.length === 0) return undefined
    const at = { start: node.start, end: node.end }
    const statement = (expression: Expression) => ({ type: "ExpressionStatement", expression, ...at })
    const fn = {
      type: "FunctionExpression",
      id: null,
      params: [],
      body: {
        type: "BlockStatement",
        body: [
          statement({ type: "ThisExpression", ...at } as Expression),
          ...fields.flatMap((f) => [
            ...(fieldKeys.has(f) ? [statement(fieldKeys.get(f)!)] : []),
            ...(f.value ? [statement(f.value)] : []),
          ]),
        ],
        ...at,
      },
      generator: false,
      expression: false,
      async: false,
      ...at,
    } as FunctionExpression
    fieldInitMembers.set(fn, fields)
    visitFunction(fn, classScope, fnInfo.index, name).flags |= CodeFlags.METHOD | CodeFlags.FIELD_INIT
    return fn
  }

  visitFunction(source.program, undefined, -1)

  const ensureUpvalue = (fnIndex: number, decl: Decl): number => {
    const fnInfo = functions[fnIndex]!
    const existing = fnInfo.upvalueMap.get(decl)
    if (existing !== undefined) return existing
    const upvalIndex = fnInfo.upvalues.length
    if (fnInfo.parentIndex === decl.fnIndex) fnInfo.upvalues.push({ from: 0, index: -1, decl })
    else fnInfo.upvalues.push({ from: 1, index: ensureUpvalue(fnInfo.parentIndex, decl), decl })
    fnInfo.upvalueMap.set(decl, upvalIndex)
    return upvalIndex
  }

  const lookupDecl = (scope: Scope | undefined, name: string): Decl | undefined =>
    scope === undefined ? undefined : (scope.decls.get(name) ?? lookupDecl(scope.parent, name))

  const refs = new Map<Identifier, ResolvedRef>()
  const thisRefs = new Map<AnyNode, ResolvedRef>()
  // Identifiers resolve first, then `this`, so upvalues keep their order.
  const resolve = (item: (typeof unresolved)[number]): ResolvedRef => {
    const decl = lookupDecl(item.scope, item.name)
    if (decl === undefined) return { kind: "global", name: item.name }
    decl.used = true
    const owner = functions[decl.fnIndex]!
    if (decl.kind === "arguments") owner.flags |= CodeFlags.USES_ARGUMENTS | CodeFlags.NEEDS_ARGS
    if (decl.kind === "this") owner.flags |= CodeFlags.USES_THIS
    if (decl.fnIndex === item.fnIndex) return { kind: "local", decl }
    decl.captured = true
    return { kind: "upval", upvalIndex: ensureUpvalue(item.fnIndex, decl), decl }
  }
  for (const item of unresolved)
    if (item.node.type !== "ThisExpression") refs.set(item.node as Identifier, resolve(item))
  for (const item of unresolved) if (item.node.type === "ThisExpression") thisRefs.set(item.node, resolve(item))
  // `super` reads the home object of the method it is in, through arrows.
  const superRefs = new Map<AnyNode, { home: ResolvedRef; self: ResolvedRef }>()
  for (const item of supers) {
    let owner = functions[item.fnIndex]!
    while (owner.node.type === "ArrowFunctionExpression") owner = functions[owner.parentIndex]!
    if ((owner.flags & CodeFlags.METHOD) === 0) continue
    owner.homeDecl ??= addDecl(owner.paramScope, owner, "%home", "home", false)
    superRefs.set(item.node, {
      home: resolve({ ...item, name: "%home" }),
      self: resolve({ ...item, name: "this" }),
    })
  }

  // Assign dense local slots per function. A call copies its arguments into the leading slots, so with simple
  // parameters each position gets a slot; an earlier duplicate name (`function f(a, a)`) gets a dummy one.
  for (const fnInfo of functions) {
    const assignSlot = (decl: Decl) => {
      if (decl.slot >= 0) return
      decl.slot = fnInfo.localNames.length
      fnInfo.localNames.push(decl.name)
    }
    if ((fnInfo.flags & CodeFlags.SIMPLE_PARAMS) !== 0) {
      fnInfo.params.forEach((p, i) => {
        const name = (p as Identifier).name
        const last = fnInfo.params.findLastIndex((q) => (q as Identifier).name === name)
        if (last === i) assignSlot(fnInfo.paramScope.decls.get(name)!)
        else fnInfo.localNames.push(name)
      })
    } else fnInfo.flags |= CodeFlags.NEEDS_ARGS
    for (const decl of fnInfo.allDecls) {
      if ((decl.kind === "this" || decl.kind === "arguments") && !decl.used) continue
      assignSlot(decl)
    }
    fnInfo.locals = fnInfo.localNames.length
  }

  // Patch `from === 0` upvalue indices now that parent local slots are assigned
  for (const fnInfo of functions) for (const u of fnInfo.upvalues) if (u.from === 0) u.index = u.decl.slot

  return {
    functions,
    nodeToFunction,
    scopeOfNode,
    refs,
    thisRefs,
    superRefs,
    classConstructors,
    classFieldInits,
    fieldInitMembers,
    fieldKeys,
  }
}

const collectPatternNames = (pattern: Pattern, out: Array<string> = []): Array<string> => {
  switch (pattern.type) {
    case "Identifier":
      out.push(pattern.name)
      break
    case "AssignmentPattern":
      collectPatternNames(pattern.left, out)
      break
    case "RestElement":
      collectPatternNames(pattern.argument, out)
      break
    case "ArrayPattern":
      for (const element of pattern.elements) if (element !== null) collectPatternNames(element, out)
      break
    case "ObjectPattern":
      for (const prop of pattern.properties) {
        collectPatternNames(prop.type === "RestElement" ? prop.argument : prop.value, out)
      }
      break
  }
  return out
}
