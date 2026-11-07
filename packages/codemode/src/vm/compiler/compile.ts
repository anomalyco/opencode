import type {
  ArrayExpression,
  ArrayPattern,
  ArrowFunctionExpression,
  AssignmentExpression,
  AwaitExpression,
  BinaryExpression,
  BlockStatement,
  CallExpression,
  CatchClause,
  ConditionalExpression,
  DoWhileStatement,
  Expression,
  ForInStatement,
  ForOfStatement,
  ForStatement,
  FunctionExpression,
  IfStatement,
  ImportExpression,
  LabeledStatement,
  Literal,
  LogicalExpression,
  MemberExpression,
  ModuleDeclaration,
  NewExpression,
  ObjectExpression,
  ObjectPattern,
  Pattern,
  Program,
  SpreadElement,
  Statement,
  SwitchStatement,
  TaggedTemplateExpression,
  TemplateLiteral,
  TryStatement,
  UnaryExpression,
  UpdateExpression,
  VariableDeclaration,
  WhileStatement,
  YieldExpression,
} from "acorn"
import { type AstNode, supportedSyntaxMessage } from "../runtime/model.js"
import { nodeId, type Source } from "../runtime/source.js"
import { Code, CodeBuilder, CodeSizeOverflow, hashOf, type Label } from "../code.js"
import {
  BinOp,
  CheckBaseKind,
  CodeFlags,
  CondKind,
  type ErrorSite,
  ImportKind,
  IterContext,
  Op,
  type OpCode,
  PutKind,
  UnaryOp,
} from "../opcodes.js"
import {
  analyzeScopes,
  type Decl,
  type FunctionInfo,
  type ResolvedRef,
  type Scope,
  type ScopeAnalysis,
} from "./scope.js"

/** Each binary operator as the op and `a` operand that apply it. */
const BinaryOps: Readonly<Record<string, readonly [OpCode, number]>> = {
  "+": [Op.ADD, 0],
  "-": [Op.SUB, 0],
  "*": [Op.MUL, 0],
  "<": [Op.LT, 0],
  "<=": [Op.LE, 0],
  ">": [Op.GT, 0],
  ">=": [Op.GE, 0],
  "===": [Op.SEQ, 0],
  "!==": [Op.SNE, 0],
  in: [Op.IN, 0],
  instanceof: [Op.INSTANCEOF, 0],
  "/": [Op.BINOP, BinOp.DIV],
  "%": [Op.BINOP, BinOp.MOD],
  "**": [Op.BINOP, BinOp.EXP],
  "&": [Op.BINOP, BinOp.BAND],
  "|": [Op.BINOP, BinOp.BOR],
  "^": [Op.BINOP, BinOp.BXOR],
  "<<": [Op.BINOP, BinOp.SHL],
  ">>": [Op.BINOP, BinOp.SAR],
  ">>>": [Op.BINOP, BinOp.SHR],
  "==": [Op.BINOP, BinOp.EQ],
  "!=": [Op.BINOP, BinOp.NE],
}

const UnaryOps: Readonly<Record<string, number>> = {
  "-": UnaryOp.NEG,
  "+": UnaryOp.PLUS,
  "~": UnaryOp.BNOT,
  typeof: UnaryOp.TYPEOF,
  void: UnaryOp.VOID,
}

/** The jump that skips the right operand of `||`, `&&`, `??` and their assignments. */
const logicalCond = (operator: string) =>
  operator.startsWith("||")
    ? CondKind.TRUTHY_KEEP
    : operator.startsWith("&&")
      ? CondKind.FALSY_KEEP
      : CondKind.NOT_NULLISH_KEEP

/** NamedEvaluation: whether `node` is an anonymous function definition, which takes the name it is assigned to. */
const isAnonymousFunction = (node: Expression): node is FunctionExpression | ArrowFunctionExpression =>
  node.type === "ArrowFunctionExpression" || (node.type === "FunctionExpression" && !node.id)

type LoopEntry = {
  readonly kind: "loop"
  readonly labels: ReadonlySet<string>
  readonly breakLabel: Label
  readonly continueLabel: Label
  readonly entryDepth: number
  readonly iterSlot: number
  readonly iterAsync: boolean
}

type ControlEntry =
  | LoopEntry
  | {
      readonly kind: "switch" | "label"
      readonly labels: ReadonlySet<string>
      readonly breakLabel: Label
      readonly entryDepth: number
    }
  | { readonly kind: "iterator"; readonly itSlot: number; readonly entryDepth: number }
  | {
      readonly kind: "finally"
      readonly tagSlot: number
      readonly valSlot: number
      readonly finallyLabel: Label
      readonly entryDepth: number
      readonly exits: Map<
        string,
        { readonly tag: number; readonly kind: "return" | "break" | "continue"; readonly target: ControlEntry | null }
      >
    }

const idx = (node: AstNode | undefined | null): number => (node ? (nodeId(node)?.index ?? -1) : -1)

/** Bump when the compiler emits different bytecode for the same source; it is part of the snapshot build id. */
export const COMPILER_VERSION = 1

const compileCache = new Map<string, ReadonlyArray<Code>>()
const MAX_CACHE_SIZE = 64

export type CompileOptions = {
  readonly internal?: boolean
  readonly forceExtra?: boolean
  readonly noCache?: boolean
}

/**
 * Compiles a `Source` into an immutable `Code[]` array indexed by pre-order function index (`0` = program).
 */
export const compileSource = (source: Source, options?: CompileOptions): ReadonlyArray<Code> => {
  const internal = options?.internal ?? false
  const forceExtra = options?.forceExtra ?? false
  const cacheable = !internal && !forceExtra && !options?.noCache && source.id === "main"
  const cached = cacheable ? compileCache.get(source.code) : undefined
  // Sites resolve against this Source's nodes.
  if (cached !== undefined) return cached.map((code) => code.withSource(source))

  const analysis = analyzeScopes(source, internal)
  const preliminary = analysis.functions.map((fnInfo) =>
    compileFunction(source, { id: source.id, hash: "" }, analysis, fnInfo, forceExtra),
  )
  const finalRef = { id: source.id, hash: hashOf(preliminary) }
  const codes = preliminary.map((code) => new Code({ ...code, source: finalRef }))

  if (cacheable) {
    if (compileCache.size >= MAX_CACHE_SIZE) compileCache.delete(compileCache.keys().next().value!)
    compileCache.set(source.code, codes)
  }
  return codes
}

const compileFunction = (
  source: Source,
  sourceRef: Code["source"],
  analysis: ScopeAnalysis,
  fnInfo: FunctionInfo,
  forceExtra: boolean,
): Code => {
  try {
    return compileFunctionBody(source, sourceRef, analysis, fnInfo, forceExtra, false)
  } catch (err) {
    if (err instanceof CodeSizeOverflow) {
      return compileFunctionBody(source, sourceRef, analysis, fnInfo, forceExtra, true)
    }
    throw err
  }
}

const compileFunctionBody = (
  source: Source,
  sourceRef: Code["source"],
  analysis: ScopeAnalysis,
  fnInfo: FunctionInfo,
  forceExtra: boolean,
  wideJumps: boolean,
): Code => {
  const isProgram = fnInfo.index === 0
  const internal = (fnInfo.flags & CodeFlags.INTERNAL) !== 0
  const builder = new CodeBuilder(
    sourceRef,
    source,
    fnInfo.index,
    fnInfo.name,
    fnInfo.flags,
    fnInfo.length,
    fnInfo.params.length,
    fnInfo.locals,
    [...fnInfo.localNames],
    Int32Array.from(fnInfo.upvalues.flatMap((u) => [u.from, u.index])),
    fnInfo.upvalues.map((u) => u.decl.name),
  )
  builder.forceExtra = forceExtra
  builder.wideJumps = wideJumps

  const controlStack: Array<ControlEntry> = []
  let pendingLabels: Set<string> | undefined
  let retSlot = -1

  const allocSlot = (name: string): number => {
    builder.localNames.push(name)
    return builder.locals++
  }

  const emitThrowError = (site: ErrorSite, node: AstNode): void => {
    builder.emit(Op.THROW_ERROR, 0, builder.constant(site), idx(node), 0)
    builder.unreachable()
  }

  const emitUnsupported = (kindName: string, node: AstNode): void =>
    emitThrowError(
      {
        type: "SyntaxError",
        message: `Syntax '${kindName}' is not supported. ${supportedSyntaxMessage}`,
        kind: "UnsupportedSyntax",
        suggestions: [supportedSyntaxMessage],
      },
      node,
    )

  // `super.x` parses inside object methods but is not supported. Code after the error is unreachable, so it emits nothing.
  const unsupportedSuper = (node: MemberExpression): boolean => {
    if (node.object.type !== "Super") return false
    emitUnsupported("Super", node.object)
    return true
  }

  const putKind = (decl: Decl, isInit: boolean) =>
    isInit ? PutKind.INIT : decl.mutable ? PutKind.ASSIGN : PutKind.CONST

  const emitLoadDecl = (decl: Decl, node?: AstNode) =>
    builder.emit(decl.captured ? Op.GET_CELL : Op.GET_LOCAL, 0, decl.slot, idx(node), 1)

  const emitStoreDecl = (decl: Decl, isInit: boolean, node?: AstNode) =>
    builder.emit(decl.captured ? Op.PUT_CELL : Op.PUT_LOCAL, putKind(decl, isInit), decl.slot, idx(node), -1)

  const emitLoadRef = (ref: ResolvedRef, node: AstNode, isTypeof = false): void => {
    if (ref.kind === "local") emitLoadDecl(ref.decl, node)
    else if (ref.kind === "upval") builder.emit(Op.GET_UPVAL, 0, ref.upvalIndex, idx(node), 1)
    else if (internal && !isTypeof) {
      // Internal code can't shadow `undefined`.
      if (ref.name === "undefined") builder.emit(Op.PUSH_UNDEF, 0, 0, idx(node), 1)
      else builder.emit(Op.GET_INTRINSIC, 0, builder.constant(ref.name), idx(node), 1)
    } else builder.emit(Op.GET_GLOBAL, isTypeof ? 1 : 0, builder.constant(ref.name), idx(node), 1)
  }

  const emitStoreRef = (ref: ResolvedRef, isInit: boolean, node: AstNode): void => {
    if (ref.kind === "local") emitStoreDecl(ref.decl, isInit, node)
    else if (ref.kind === "upval") builder.emit(Op.PUT_UPVAL, putKind(ref.decl, isInit), ref.upvalIndex, idx(node), -1)
    // Global assignment: checks if global exists (`Cannot assign to constant`) or unknown (`Unknown identifier`)
    else builder.emit(Op.GET_GLOBAL, 2, builder.constant(ref.name), idx(node), -1)
  }

  const emitScopePrologue = (scope: Scope, resetUncapturedLexicals: boolean): void => {
    for (const decl of scope.decls.values()) {
      if (decl.kind === "this" || decl.kind === "arguments" || decl.kind === "param" || decl.kind === "self") continue
      if (decl.captured) builder.emit(Op.NEW_CELL, 0, decl.slot)
      else if (resetUncapturedLexicals && (decl.kind === "let" || decl.kind === "const")) {
        builder.emit(Op.HOLE_LOCAL, 0, decl.slot)
      }
    }
    for (const decl of scope.decls.values()) {
      if (decl.kind !== "var") continue
      if (decl.copyFromParam !== undefined) emitLoadDecl(decl.copyFromParam)
      else builder.emit(Op.PUSH_UNDEF, 0, 0, -1, 1)
      emitStoreDecl(decl, true)
    }
    emitHoistedFunctions(scope)
  }

  const emitHoistedFunctions = (scope: Scope): void => {
    for (const hoisted of scope.hoistedFunctions) {
      if (hoisted.fnIndex < 0) continue
      builder.emit(Op.CLOSURE, 0, hoisted.fnIndex, idx(hoisted.node), 1)
      emitStoreDecl(hoisted.decl, true, hoisted.node)
    }
  }

  const emitImports = (stmts: ReadonlyArray<Statement | ModuleDeclaration>): void => {
    for (const stmt of stmts) {
      if (stmt.type !== "ImportDeclaration") continue
      const specifier = String(stmt.source.value)
      if (stmt.specifiers.length === 0) {
        builder.emit(Op.IMPORT, ImportKind.SIDE_EFFECT, builder.constant({ specifier }), idx(stmt), 0)
      }
      for (const spec of stmt.specifiers) {
        if (spec.type === "ImportSpecifier") {
          const imported = spec.imported.type === "Identifier" ? spec.imported.name : String(spec.imported.value)
          builder.emit(Op.IMPORT, ImportKind.NAMED, builder.constant({ specifier, imported }), idx(spec), 1)
        } else {
          const kind = spec.type === "ImportDefaultSpecifier" ? ImportKind.DEFAULT : ImportKind.NAMESPACE
          builder.emit(Op.IMPORT, kind, builder.constant({ specifier }), idx(spec), 1)
        }
        emitStoreDecl(fnInfo.bodyScope.decls.get(spec.local.name)!, true, spec)
      }
    }
  }

  // --- Iteration (fast paths inline, a custom iterator's calls out of line) ---

  // Opens an iterator over the value on top into `itSlot`. The returned function emits the out-of-line path that
  // calls a custom `[Symbol.iterator]` method.
  const emitIterOpen = (context: number, itSlot: number, base: number, node: AstNode) => {
    const slow = builder.newLabel(base + 2)
    const join = builder.newLabel(base + 1)
    builder.emitJump(Op.ITER_OPEN, context, slow, idx(node), 0, 1)
    builder.emitJump(Op.JUMP, 0, slow, idx(node), 0, null)
    builder.mark(join)
    builder.emit(Op.PUT_LOCAL, PutKind.INIT, itSlot, idx(node), -1)
    return () => {
      builder.mark(slow)
      builder.emit(Op.CALL, 0, 0, idx(node), -1)
      builder.emit(Op.ITER_INIT, context, 0, idx(node), 0)
      builder.emitJump(Op.JUMP, 0, join, idx(node), 0, null)
    }
  }

  // Pushes the next value, or jumps to `done`. The returned function emits the out-of-line path that calls a custom
  // `next` method.
  const emitIterStep = (itSlot: number, base: number, done: Label, node: AstNode, isAwait = false) => {
    const got = builder.newLabel(base + 1)
    const slow = builder.newLabel(base + 2)
    builder.emitJump(Op.ITER_STEP, itSlot, done, idx(node), 0, 2)
    builder.emitJump(Op.JUMP, 0, slow, idx(node), 0, null)
    builder.mark(got)
    return () => {
      builder.mark(slow)
      builder.emit(Op.CALL, 0, 0, idx(node), -1)
      if (isAwait) builder.emit(Op.AWAIT, 0, 0, idx(node), 0)
      builder.emitJump(Op.ITER_RESULT, itSlot, done, idx(node), -1, 0)
      builder.emitJump(Op.JUMP, 0, got, idx(node), 0, null)
    }
  }

  // Appends what is left of the iterator to the array on top (at `base`). `beforeSlow` emits other out-of-line code.
  const emitAppendRest = (itSlot: number, base: number, node: AstNode, beforeSlow?: () => void): void => {
    const loop = builder.newLabel(base)
    const done = builder.newLabel(base)
    builder.emitJump(Op.ITER_APPEND_ALL, itSlot, loop, idx(node), 0, 0)
    builder.emitJump(Op.JUMP, 0, done, idx(node), 0, 0)
    builder.mark(loop)
    const slow = emitIterStep(itSlot, base, done, node)
    builder.emit(Op.ARRAY_APPEND, 0, 0, idx(node), -1)
    builder.emitJump(Op.JUMP, 0, loop, idx(node), 0, 0)
    beforeSlow?.()
    slow()
    builder.mark(done)
  }

  const emitIteratorCloseNormal = (itSlot: number, iterAsync: boolean, node: AstNode): void => {
    const skipLabel = builder.newLabel(builder.depth)
    builder.emitJump(Op.ITER_CLOSE, itSlot, skipLabel, idx(node), 0, 2)
    builder.emit(Op.CALL, 0, 0, idx(node), -1)
    if (iterAsync) builder.emit(Op.AWAIT, 0, 0, idx(node), 0)
    builder.emit(Op.ITER_INIT, IterContext.CHECK_OBJECT, 0, idx(node), 0)
    builder.emit(Op.POP, 0, 0, idx(node), -1)
    builder.mark(skipLabel)
  }

  // The handler for a throw out of `ranges`: closes the iterator, ignoring an error from closing it, and rethrows.
  const emitCloseOnThrow = (
    ranges: ReadonlyArray<readonly [number, number]>,
    itSlot: number,
    errSlot: number,
    entryDepth: number,
    node: AstNode,
    isAwait = false,
  ): void => {
    const catchLabel = builder.newLabel(entryDepth + 1)
    builder.mark(catchLabel)
    for (const [start, end] of ranges) builder.addHandler(start, end, catchLabel.pc, entryDepth)
    builder.emit(Op.PUT_LOCAL, PutKind.INIT, errSlot, idx(node), -1)
    const rethrowLabel = builder.newLabel(entryDepth)
    const swallowLabel = builder.newLabel(entryDepth + 1)
    const closeStart = builder.pc
    builder.emitJump(Op.ITER_CLOSE, itSlot, rethrowLabel, idx(node), 0, 2)
    builder.emit(Op.CALL, 0, 0, idx(node), -1)
    if (isAwait) builder.emit(Op.AWAIT, 0, 0, idx(node), 0)
    builder.emit(Op.POP, 0, 0, idx(node), -1)
    const closeEnd = builder.pc
    builder.mark(rethrowLabel)
    builder.emit(Op.GET_LOCAL, 0, errSlot, idx(node), 1)
    builder.emit(Op.THROW, 0, 0, idx(node), -1)
    builder.mark(swallowLabel)
    builder.emit(Op.POP, 0, 0, idx(node), -1)
    builder.emitJump(Op.JUMP, 0, rethrowLabel, idx(node), 0, null)
    builder.addHandler(closeStart, closeEnd, swallowLabel.pc, entryDepth)
  }

  // --- Exit Plan (return, break, continue across iterators and finally blocks; C1, C3, C4) ---
  const findExitTarget = (kind: "break" | "continue", label: string | undefined): ControlEntry | null => {
    for (let i = controlStack.length - 1; i >= 0; i--) {
      const e = controlStack[i]!
      if (e.kind === "finally" || e.kind === "iterator") continue
      if (kind === "break" && (label !== undefined ? e.labels.has(label) : e.kind === "loop" || e.kind === "switch"))
        return e
      if (kind === "continue" && e.kind === "loop" && (label === undefined || e.labels.has(label))) return e
    }
    return null
  }

  const exitPlan = (kind: "return" | "break" | "continue", target: ControlEntry | null, node: AstNode): void => {
    if (builder.depth < 0) return
    const stop = target ? controlStack.indexOf(target) : -1
    const crossing = controlStack.slice(stop + 1).reverse()
    const needsRet =
      kind === "return" &&
      crossing.some((e) => e.kind === "finally" || e.kind === "iterator" || (e.kind === "loop" && e.iterSlot >= 0))

    if (kind === "return" && !needsRet) {
      // C1: RETURN discards the frame directly when nothing needs closing or routing
      builder.emit(Op.RETURN, 0, 0, idx(node), -1)
      builder.unreachable()
      return
    }

    if (needsRet) {
      if (retSlot === -1) retSlot = allocSlot("%ret")
      builder.emit(Op.PUT_LOCAL, PutKind.INIT, retSlot, idx(node), -1)
    }

    const popTo = (d: number) => {
      const drop = builder.depth - d
      if (drop > 0) builder.emit(Op.POPN, 0, drop, idx(node), -drop)
    }

    for (const e of crossing) {
      popTo(e.entryDepth)
      if (e.kind === "iterator") emitIteratorCloseNormal(e.itSlot, false, node)
      else if (e.kind === "loop" && e.iterSlot >= 0) emitIteratorCloseNormal(e.iterSlot, e.iterAsync, node)
      else if (e.kind === "finally") {
        const key = `${kind}:${target ? stop : ""}`
        let exit = e.exits.get(key)
        if (!exit) {
          exit = { tag: e.exits.size + 2, kind, target }
          e.exits.set(key, exit)
        }
        if (kind === "return") {
          builder.emit(Op.GET_LOCAL, 0, retSlot, idx(node), 1)
          builder.emit(Op.PUT_LOCAL, PutKind.INIT, e.valSlot, idx(node), -1)
        }
        builder.emitNumber(exit.tag, idx(node))
        builder.emit(Op.PUT_LOCAL, PutKind.INIT, e.tagSlot, idx(node), -1)
        builder.emitJump(Op.JUMP, 0, e.finallyLabel, idx(node), 0, null)
        return
      }
    }

    if (kind === "return") {
      popTo(0)
      builder.emit(Op.GET_LOCAL, 0, retSlot, idx(node), 1)
      builder.emit(Op.RETURN, 0, 0, idx(node), -1)
      builder.unreachable()
      return
    }

    if (target && target.kind !== "iterator" && target.kind !== "finally") {
      popTo(target.entryDepth)
      if (kind === "break" && target.kind === "loop" && target.iterSlot >= 0) {
        emitIteratorCloseNormal(target.iterSlot, target.iterAsync, node)
      }
      const dst = kind === "break" ? target.breakLabel : (target as LoopEntry).continueLabel
      builder.emitJump(Op.JUMP, 0, dst, idx(node), 0, null)
      return
    }

    emitThrowError({ type: "TypeError", message: `Unexpected '${kind}' outside of a loop.` }, node)
  }

  // --- Pattern Compilation (value to bind is on top of stack: depth -> depth - 1) ---
  const compilePattern = (pattern: Pattern, isDecl: boolean, isInit: boolean, contextNode: AstNode): void => {
    switch (pattern.type) {
      case "Identifier":
        emitStoreRef(analysis.refs.get(pattern)!, isInit, isDecl ? contextNode : pattern)
        return
      case "MemberExpression": {
        // Stack has [value]. Evaluate target object and key, then write [value].
        const valSlot = allocSlot("%mval")
        builder.emit(Op.PUT_LOCAL, PutKind.INIT, valSlot, idx(pattern), -1)
        if (unsupportedSuper(pattern)) return
        compileExpression(pattern.object as Expression)
        if (pattern.computed) {
          compileExpression(pattern.property as Expression)
          emitWritableKey(pattern)
          builder.emit(Op.GET_LOCAL, 0, valSlot, idx(pattern), 1)
          builder.emit(Op.PUT_ELEM, 0, 0, idx(pattern), -2)
        } else {
          const k = builder.constant(propertyName(pattern))
          builder.emit(Op.CHECK_BASE, CheckBaseKind.WRITE_PROP, k, idx(pattern), 0)
          builder.emit(Op.GET_LOCAL, 0, valSlot, idx(pattern), 1)
          builder.emit(Op.PUT_PROP, 0, k, idx(pattern), -1)
        }
        builder.emit(Op.POP, 0, 0, idx(pattern), -1)
        return
      }
      case "AssignmentPattern": {
        const definedLabel = builder.newLabel(builder.depth)
        builder.emitJump(Op.JUMP_COND, CondKind.DEFINED, definedLabel, idx(pattern), 0, -1)
        if (pattern.left.type === "Identifier") compileNamedExpression(pattern.right, pattern.left.name)
        else compileExpression(pattern.right)
        builder.mark(definedLabel)
        compilePattern(pattern.left, isDecl, isInit, contextNode)
        return
      }
      case "ObjectPattern":
        return compileObjectPattern(pattern, isDecl, isInit)
      case "ArrayPattern":
        return compileArrayPattern(pattern, isDecl, isInit)
      default:
        emitThrowError({ type: "TypeError", message: `Unsupported binding pattern '${pattern.type}'.` }, pattern)
    }
  }

  // A computed member's key as a write target: `[o, k] -> [o, key]`.
  const emitWritableKey = (node: MemberExpression): void => {
    builder.emit(Op.CHECK_BASE, CheckBaseKind.READ, 0, idx(node), 0)
    builder.emit(Op.TO_KEY, 0, 0, idx(node.property), 0)
    builder.emit(Op.CHECK_BASE, CheckBaseKind.WRITE_ELEM, 0, idx(node), 0)
  }

  const compileObjectPattern = (pattern: ObjectPattern, isDecl: boolean, isInit: boolean): void => {
    builder.emit(Op.CHECK_BASE, CheckBaseKind.DESTRUCTURE, 0, idx(pattern), 0)
    const props = pattern.properties
    const lastProp = props.at(-1)
    if (lastProp === undefined) {
      builder.emit(Op.POP, 0, 0, idx(pattern), -1)
      return
    }
    if (lastProp.type !== "RestElement") {
      props.forEach((prop, i) => {
        if (prop.type === "RestElement") return
        if (i < props.length - 1) builder.emit(Op.DUP, 0, 0, idx(prop), 1)
        if (prop.computed) {
          compileExpression(prop.key as Expression)
          builder.emit(Op.TO_KEY, 0, 0, idx(prop.key), 0)
          builder.emit(Op.GET_ELEM, 2, 0, idx(prop), -1)
        } else builder.emit(Op.GET_PROP, 2, builder.constant(keyName(prop.key)), idx(prop), 0)
        compilePattern(prop.value, isDecl, isInit, prop)
      })
      return
    }

    // ObjectPattern with RestElement at the end: keep `[src, k1, ..., kn]` on the stack for `COPY_REST n`
    const count = props.length - 1
    props.slice(0, count).forEach((prop, i) => {
      if (prop.type === "RestElement") return
      if (prop.computed) {
        compileExpression(prop.key as Expression)
        builder.emit(Op.TO_KEY, 0, 0, idx(prop.key), 0)
      } else builder.emitString(keyName(prop.key), idx(prop.key))
      // Stack is `[src, k1, ..., k_{i+1}]`. Pick `src` (at offset i + 1) and `k_{i+1}` (at offset 1 after picking src).
      builder.emit(Op.PICK, i + 1, 0, idx(prop), 1)
      builder.emit(Op.PICK, 1, 0, idx(prop), 1)
      builder.emit(Op.GET_ELEM, 2, 0, idx(prop), -1)
      compilePattern(prop.value, isDecl, isInit, prop)
    })
    builder.emit(Op.COPY_REST, 0, count, idx(lastProp), -count)
    compilePattern(lastProp.argument, isDecl, isInit, lastProp)
  }

  const compileArrayPattern = (pattern: ArrayPattern, isDecl: boolean, isInit: boolean): void => {
    const itSlot = allocSlot("%it")
    const errSlot = allocSlot("%e")
    const entryDepth = builder.depth - 1
    const openSlow = emitIterOpen(IterContext.DESTRUCTURE, itSlot, entryDepth, pattern)
    controlStack.push({ kind: "iterator", itSlot, entryDepth })
    const protectedRanges: Array<readonly [number, number]> = []
    const bind = (target: Pattern, node: AstNode) => {
      const start = builder.pc
      compilePattern(target, isDecl, isInit, node)
      protectedRanges.push([start, builder.pc])
    }

    for (const el of pattern.elements) {
      if (el?.type === "RestElement") {
        // Drain remaining elements into a new array, then bind
        builder.emit(Op.NEW_ARRAY, 0, 0, idx(el), 1)
        emitAppendRest(itSlot, entryDepth + 1, el)
        bind(el.argument, el)
        break
      }
      const node = el ?? pattern
      const doneLabel = builder.newLabel(entryDepth)
      const afterLabel = builder.newLabel(entryDepth)
      const slow = emitIterStep(itSlot, entryDepth, doneLabel, node)
      // Elision: step iterator and discard value
      if (el === null) builder.emit(Op.POP, 0, 0, idx(pattern), -1)
      else bind(el, el)
      builder.emitJump(Op.JUMP, 0, afterLabel, idx(node), 0, 0)
      slow()
      builder.mark(doneLabel)
      if (el !== null) {
        builder.emit(Op.PUSH_UNDEF, 0, 0, idx(el), 1)
        bind(el, el)
      }
      builder.mark(afterLabel)
    }

    controlStack.pop()
    emitIteratorCloseNormal(itSlot, false, pattern)
    const endLabel = builder.newLabel(entryDepth)
    builder.emitJump(Op.JUMP, 0, endLabel, idx(pattern), 0, 0)
    openSlow()
    emitCloseOnThrow(protectedRanges, itSlot, errSlot, entryDepth, pattern)
    builder.mark(endLabel)
  }

  // --- Statements ---
  const compileStatement = (stmt: Statement | ModuleDeclaration): void => {
    const labels = pendingLabels
    pendingLabels = undefined
    if (builder.depth < 0) return
    const compile = statements[stmt.type] as ((node: typeof stmt, labels?: Set<string>) => void) | undefined
    if (compile) compile(stmt, labels)
    else emitUnsupported(stmt.type, stmt)
  }

  const withStatementLabels = (labels: Set<string> | undefined, body: () => void): void => {
    if (!labels || labels.size === 0) return body()
    const breakLabel = builder.newLabel(builder.depth)
    controlStack.push({ kind: "label", labels, breakLabel, entryDepth: builder.depth })
    body()
    controlStack.pop()
    builder.mark(breakLabel)
  }

  const pushLoop = (
    labels: Set<string> | undefined,
    breakLabel: Label,
    continueLabel: Label,
    entryDepth: number,
    iterSlot = -1,
    iterAsync = false,
  ) =>
    controlStack.push({
      kind: "loop",
      labels: labels ?? new Set(),
      breakLabel,
      continueLabel,
      entryDepth,
      iterSlot,
      iterAsync,
    })

  const compileVariableDeclaration = (node: VariableDeclaration): void => {
    const isVar = node.kind === "var"
    for (const decl of node.declarations) {
      if (isVar && !decl.init && decl.id.type === "Identifier") continue
      if (!decl.init) builder.emit(Op.PUSH_UNDEF, 0, 0, idx(decl), 1)
      else if (decl.id.type === "Identifier") compileNamedExpression(decl.init, decl.id.name)
      else compileExpression(decl.init)
      compilePattern(decl.id, !isVar, !isVar, decl)
    }
  }

  const compileBlockStatement = (node: BlockStatement, labels?: Set<string>): void =>
    withStatementLabels(labels, () => {
      const scope = analysis.scopeOfNode.get(node)
      if (scope && (scope.decls.size > 0 || scope.hoistedFunctions.length > 0)) emitScopePrologue(scope, true)
      for (const s of node.body) compileStatement(s)
    })

  const compileIfStatement = (node: IfStatement, labels?: Set<string>): void =>
    withStatementLabels(labels, () => {
      const elseLabel = builder.newLabel(builder.depth)
      const endLabel = builder.newLabel(builder.depth)
      compileExpression(node.test)
      builder.emitJump(Op.JUMP_IF_FALSE, 0, node.alternate ? elseLabel : endLabel, idx(node), -1, -1)
      compileStatement(node.consequent)
      if (node.alternate) {
        builder.emitJump(Op.JUMP, 0, endLabel, idx(node), 0, null)
        builder.mark(elseLabel)
        compileStatement(node.alternate)
      }
      builder.mark(endLabel)
    })

  const compileWhileStatement = (node: WhileStatement, labels?: Set<string>): void => {
    const entryDepth = builder.depth
    const testLabel = builder.newLabel(entryDepth)
    const continueLabel = builder.newLabel(entryDepth)
    const breakLabel = builder.newLabel(entryDepth)
    builder.mark(testLabel)
    compileExpression(node.test)
    builder.emitJump(Op.JUMP_IF_FALSE, 0, breakLabel, idx(node), -1, -1)
    pushLoop(labels, breakLabel, continueLabel, entryDepth)
    compileStatement(node.body)
    controlStack.pop()
    builder.mark(continueLabel)
    builder.emitJump(Op.LOOP, 0, testLabel, idx(node), 0, null)
    builder.mark(breakLabel)
  }

  const compileDoWhileStatement = (node: DoWhileStatement, labels?: Set<string>): void => {
    const entryDepth = builder.depth
    const bodyLabel = builder.newLabel(entryDepth)
    const continueLabel = builder.newLabel(entryDepth)
    const breakLabel = builder.newLabel(entryDepth)
    builder.mark(bodyLabel)
    pushLoop(labels, breakLabel, continueLabel, entryDepth)
    compileStatement(node.body)
    controlStack.pop()
    builder.mark(continueLabel)
    compileExpression(node.test)
    builder.emitJump(Op.JUMP_IF_FALSE, 0, breakLabel, idx(node), -1, -1)
    builder.emitJump(Op.LOOP, 0, bodyLabel, idx(node), 0, null)
    builder.mark(breakLabel)
  }

  const compileForStatement = (node: ForStatement, labels?: Set<string>): void => {
    const entryDepth = builder.depth
    const forScope = analysis.scopeOfNode.get(node)!
    emitScopePrologue(forScope, true)
    if (node.init?.type === "VariableDeclaration") compileVariableDeclaration(node.init)
    else if (node.init) compileEffect(node.init)
    // Each iteration gets fresh cells for the bindings its closures capture.
    const copyCells = () => {
      for (const d of forScope.decls.values()) if (d.captured) builder.emit(Op.COPY_CELL, 0, d.slot, idx(node), 0)
    }
    copyCells()
    const testLabel = builder.newLabel(entryDepth)
    const continueLabel = builder.newLabel(entryDepth)
    const breakLabel = builder.newLabel(entryDepth)
    builder.mark(testLabel)
    if (node.test) {
      compileExpression(node.test)
      builder.emitJump(Op.JUMP_IF_FALSE, 0, breakLabel, idx(node), -1, -1)
    }
    pushLoop(labels, breakLabel, continueLabel, entryDepth)
    compileStatement(node.body)
    controlStack.pop()
    builder.mark(continueLabel)
    copyCells()
    if (node.update) compileEffect(node.update)
    builder.emitJump(Op.LOOP, 0, testLabel, idx(node), 0, null)
    builder.mark(breakLabel)
  }

  // The binding a for...in or for...of assigns each value to, inside the loop's own scope when it is lexical.
  const compileLoopBinding = (node: ForInStatement | ForOfStatement): void => {
    if (node.left.type !== "VariableDeclaration") return compilePattern(node.left, false, false, node.left)
    const lexical = node.left.kind !== "var"
    if (lexical) emitScopePrologue(analysis.scopeOfNode.get(node)!, true)
    compilePattern(node.left.declarations[0]!.id, lexical, lexical, node.left)
  }

  const loopScopePrologue = (node: ForInStatement | ForOfStatement): void => {
    if (node.left.type === "VariableDeclaration" && node.left.kind !== "var") {
      emitScopePrologue(analysis.scopeOfNode.get(node)!, true)
    }
  }

  const compileForInStatement = (node: ForInStatement, labels?: Set<string>): void => {
    const entryDepth = builder.depth
    loopScopePrologue(node)
    compileExpression(node.right)
    const itSlot = allocSlot("%it")
    builder.emit(Op.FOR_IN, 0, 0, idx(node.right), 0)
    builder.emit(Op.PUT_LOCAL, PutKind.INIT, itSlot, idx(node), -1)
    const stepLabel = builder.newLabel(entryDepth)
    const continueLabel = builder.newLabel(entryDepth)
    const breakLabel = builder.newLabel(entryDepth)
    builder.mark(stepLabel)
    const stepSlow = emitIterStep(itSlot, entryDepth, breakLabel, node)
    compileLoopBinding(node)
    pushLoop(labels, breakLabel, continueLabel, entryDepth)
    compileStatement(node.body)
    controlStack.pop()
    builder.mark(continueLabel)
    builder.emitJump(Op.LOOP, 0, stepLabel, idx(node), 0, null)
    stepSlow()
    builder.mark(breakLabel)
  }

  const compileForOfStatement = (node: ForOfStatement, labels?: Set<string>): void => {
    const isAwait = node.await
    const entryDepth = builder.depth
    loopScopePrologue(node)
    compileExpression(node.right)
    const itSlot = allocSlot("%it")
    const errSlot = allocSlot("%e")
    const openSlow = emitIterOpen(isAwait ? IterContext.FOR_AWAIT : IterContext.FOR_OF, itSlot, entryDepth, node)
    const stepLabel = builder.newLabel(entryDepth)
    const continueLabel = builder.newLabel(entryDepth)
    const breakLabel = builder.newLabel(entryDepth)
    builder.mark(stepLabel)
    const stepSlow = emitIterStep(itSlot, entryDepth, breakLabel, node, isAwait)
    // C4: iterSlot belongs to the loop entry itself (`break` and `return` close it, `continue` does not)
    pushLoop(labels, breakLabel, continueLabel, entryDepth, itSlot, isAwait)
    const bodyStart = builder.pc
    compileLoopBinding(node)
    compileStatement(node.body)
    controlStack.pop()
    builder.mark(continueLabel)
    builder.emitJump(Op.LOOP, 0, stepLabel, idx(node), 0, null)
    const bodyEnd = builder.pc
    openSlow()
    stepSlow()
    emitCloseOnThrow([[bodyStart, bodyEnd]], itSlot, errSlot, entryDepth, node, isAwait)
    builder.mark(breakLabel)
  }

  const compileSwitchStatement = (node: SwitchStatement, labels?: Set<string>): void => {
    const entryDepth = builder.depth
    compileExpression(node.discriminant)
    const discSlot = allocSlot("%disc")
    builder.emit(Op.PUT_LOCAL, PutKind.INIT, discSlot, idx(node), -1)
    emitScopePrologue(analysis.scopeOfNode.get(node)!, true)
    const breakLabel = builder.newLabel(entryDepth)
    const caseLabels = node.cases.map(() => builder.newLabel(entryDepth))
    let defaultLabel: Label | undefined
    node.cases.forEach((clause, i) => {
      if (!clause.test) {
        defaultLabel = caseLabels[i]
        return
      }
      builder.emit(Op.GET_LOCAL, 0, discSlot, idx(clause), 1)
      compileExpression(clause.test)
      builder.emit(Op.SEQ, 0, 0, idx(clause), -1)
      builder.emitJump(Op.JUMP_IF_TRUE, 0, caseLabels[i]!, idx(clause), -1, -1)
    })
    builder.emitJump(Op.JUMP, 0, defaultLabel ?? breakLabel, idx(node), 0, 0)
    controlStack.push({ kind: "switch", labels: labels ?? new Set(), breakLabel, entryDepth })
    node.cases.forEach((clause, i) => {
      builder.mark(caseLabels[i]!)
      for (const s of clause.consequent) compileStatement(s)
    })
    controlStack.pop()
    builder.mark(breakLabel)
  }

  const compileLabeledStatement = (node: LabeledStatement, existingLabels?: Set<string>): void => {
    const labels = existingLabels ?? new Set<string>()
    let cur: Statement = node
    for (; cur.type === "LabeledStatement"; cur = cur.body) labels.add(cur.label.name)
    pendingLabels = labels
    compileStatement(cur)
  }

  const compileTryCatch = (block: BlockStatement, handler: CatchClause, parentNode: AstNode): void => {
    const entryDepth = builder.depth
    const catchLabel = builder.newLabel(entryDepth + 1)
    const endLabel = builder.newLabel(entryDepth)
    const tryStart = builder.pc
    compileBlockStatement(block)
    const tryEnd = builder.pc
    builder.emitJump(Op.JUMP, 0, endLabel, idx(parentNode), 0, null)
    builder.mark(catchLabel)
    builder.addHandler(tryStart, tryEnd, catchLabel.pc, entryDepth)
    emitScopePrologue(analysis.scopeOfNode.get(handler)!, true)
    if (handler.param) compilePattern(handler.param, true, true, handler)
    else builder.emit(Op.POP, 0, 0, idx(handler), -1)
    compileBlockStatement(handler.body)
    builder.mark(endLabel)
  }

  const compileTryStatement = (node: TryStatement, labels?: Set<string>): void =>
    withStatementLabels(labels, () => {
      if (!node.finalizer) return compileTryCatch(node.block, node.handler!, node)

      // try/[catch]/finally with static tag routing (§3.5, C3)
      const entryDepth = builder.depth
      const level = builder.reserveFinally()
      const tagSlot = allocSlot(`%ftag${level}`)
      const valSlot = allocSlot(`%fval${level}`)
      const finallyLabel = builder.newLabel(entryDepth)
      const afterFinallyLabel = builder.newLabel(entryDepth)
      const finallyThrowLabel = builder.newLabel(entryDepth + 1)
      const finallyEntry = { kind: "finally", tagSlot, valSlot, finallyLabel, entryDepth, exits: new Map() } as const

      controlStack.push(finallyEntry)
      const tryStart = builder.pc
      if (node.handler) compileTryCatch(node.block, node.handler, node)
      else compileBlockStatement(node.block)
      const tryEnd = builder.pc
      builder.emitNumber(0, idx(node))
      builder.emit(Op.PUT_LOCAL, PutKind.INIT, tagSlot, idx(node), -1)
      builder.emitJump(Op.JUMP, 0, finallyLabel, idx(node), 0, null)

      // Throw out of try/catch -> tag = 1, val = e, fall into finally
      builder.mark(finallyThrowLabel)
      builder.addHandler(tryStart, tryEnd, finallyThrowLabel.pc, entryDepth)
      builder.emit(Op.PUT_LOCAL, PutKind.INIT, valSlot, idx(node), -1)
      builder.emitNumber(1, idx(node))
      builder.emit(Op.PUT_LOCAL, PutKind.INIT, tagSlot, idx(node), -1)
      controlStack.pop()

      // Finally body at `entryDepth`
      builder.mark(finallyLabel)
      compileBlockStatement(node.finalizer)

      const targets = new Array<number>(finallyEntry.exits.size + 2).fill(-1)
      if (builder.depth >= 0) {
        builder.emit(Op.END_FINALLY, 0, level, idx(node), 0)
        builder.unreachable()
        for (const exit of finallyEntry.exits.values()) {
          targets[exit.tag] = builder.pc
          builder.setDepth(entryDepth)
          if (exit.kind === "return") builder.emit(Op.GET_LOCAL, 0, valSlot, idx(node), 1)
          exitPlan(exit.kind, exit.target, node)
        }
      }

      builder.mark(afterFinallyLabel)
      targets[0] = afterFinallyLabel.pc
      builder.setFinally(level, tagSlot, valSlot, entryDepth, targets)
    })

  // --- Expressions (depth -> depth + 1, or `compileEffect` depth -> depth) ---
  const compileEffect = (expr: Expression): void => {
    if (expr.type === "AssignmentExpression" && expr.left.type === "Identifier" && !isLogicalAssignment(expr)) {
      return compileAssignmentExpression(expr, true)
    }
    if (expr.type === "UpdateExpression" && expr.argument.type === "Identifier") {
      const ref = analysis.refs.get(expr.argument)!
      emitLoadRef(ref, expr.argument)
      builder.emit(Op.INC, expr.operator === "++" ? 0 : 1, 0, idx(expr), 0)
      emitStoreRef(ref, false, expr.argument)
      return
    }
    compileExpression(expr)
    builder.emit(Op.POP, 0, 0, idx(expr), -1)
  }

  const compileNamedExpression = (expr: Expression, targetName: string): void => {
    compileExpression(expr)
    if (isAnonymousFunction(expr)) builder.emit(Op.SET_NAME, 0, builder.constant(targetName), idx(expr), 0)
  }

  const compileExpression = (expr: Expression, chainShortCircuit?: Label): void => {
    const compile = expressions[expr.type] as ((node: Expression, short?: Label) => void) | undefined
    if (compile) compile(expr, chainShortCircuit)
    else emitUnsupported(expr.type, expr)
  }

  const compileLiteral = (node: Literal): void => {
    const v = node.value
    if (node.regex) {
      const k = builder.constant({ pattern: node.regex.pattern, flags: node.regex.flags })
      builder.emit(Op.REGEXP, 0, k, idx(node), 1)
    } else if (typeof v === "bigint")
      emitThrowError({ type: "TypeError", message: "BigInt literals are not supported." }, node)
    else if (v === null) builder.emit(Op.PUSH_NULL, 0, 0, idx(node), 1)
    else if (typeof v === "boolean") builder.emit(Op.PUSH_BOOL, v ? 1 : 0, 0, idx(node), 1)
    else if (typeof v === "number") builder.emitNumber(v, idx(node))
    else builder.emitString(v as string, idx(node))
  }

  // Stack has `[arr]`: appends every value the spread argument iterates to it.
  const compileSpreadAppend = (spreadNode: SpreadElement): void => {
    const baseDepth = builder.depth
    const itSlot = allocSlot("%it")
    compileExpression(spreadNode.argument)
    const openSlow = emitIterOpen(IterContext.SPREAD, itSlot, baseDepth, spreadNode)
    emitAppendRest(itSlot, baseDepth, spreadNode, openSlow)
  }

  const compileArrayExpression = (node: ArrayExpression): void => {
    const elements = node.elements
    if (!elements.some((el) => el === null || el.type === "SpreadElement")) {
      for (const el of elements) compileExpression(el as Expression)
      builder.emit(Op.NEW_ARRAY, 0, elements.length, idx(node), 1 - elements.length)
      return
    }
    builder.emit(Op.NEW_ARRAY, 0, 0, idx(node), 1)
    for (const el of elements) {
      if (el === null) builder.emit(Op.ARRAY_APPEND, 1, 0, idx(node), 0)
      else if (el.type === "SpreadElement") compileSpreadAppend(el)
      else {
        compileExpression(el)
        builder.emit(Op.ARRAY_APPEND, 0, 0, idx(node), -1)
      }
    }
  }

  // Pushes call arguments, or one array of them when one is spread (or there are too many for an operand): true then.
  const emitArguments = (args: ReadonlyArray<Expression | SpreadElement>, node: AstNode): boolean => {
    if (!args.some((a) => a.type === "SpreadElement") && args.length <= 254) {
      for (const arg of args) compileExpression(arg as Expression)
      return false
    }
    builder.emit(Op.NEW_ARRAY, 0, 0, idx(node), 1)
    for (const arg of args) {
      if (arg.type === "SpreadElement") compileSpreadAppend(arg)
      else {
        compileExpression(arg)
        builder.emit(Op.ARRAY_APPEND, 0, 0, idx(arg), -1)
      }
    }
    return true
  }

  const compileObjectExpression = (node: ObjectExpression): void => {
    builder.emit(Op.NEW_OBJECT, 0, 0, idx(node), 1)
    for (const prop of node.properties) {
      if (prop.type === "SpreadElement") {
        compileExpression(prop.argument)
        builder.emit(Op.COPY_DATA_PROPS, 0, 0, idx(prop), -1)
      } else if (prop.kind !== "init") {
        emitThrowError({ type: "TypeError", message: "Only init object properties are supported." }, prop)
      } else if (prop.computed) {
        compileExpression(prop.key as Expression)
        builder.emit(Op.TO_KEY, 0, 0, idx(prop.key), 0)
        compileExpression(prop.value as Expression)
        if (isAnonymousFunction(prop.value as Expression)) builder.emit(Op.SET_NAME, 1, 0, idx(prop.value), 0)
        builder.emit(Op.DEFINE_FIELD, 1, 0, idx(prop), -2)
      } else {
        const bigint = prop.key.type === "Literal" && typeof prop.key.value === "bigint"
        if (bigint) emitThrowError({ type: "TypeError", message: "BigInt literals are not supported." }, prop.key)
        const name = bigint ? "" : keyName(prop.key)
        compileNamedExpression(prop.value as Expression, name)
        builder.emit(Op.DEFINE_FIELD, 0, builder.constant(name), idx(prop), -1)
      }
    }
  }

  const compileTemplateLiteral = (node: TemplateLiteral): void => {
    const quasis = node.quasis
    const exprs = node.expressions
    // Untagged templates always have cooked strings: an invalid escape is a syntax error.
    if (exprs.length === 0) return builder.emitString(quasis[0]!.value.cooked!, idx(node))
    let parts = 0
    quasis.forEach((q, i) => {
      if (q.value.cooked!.length > 0 || parts === 0) {
        builder.emitString(q.value.cooked!, idx(q))
        parts++
      }
      if (i >= exprs.length) return
      compileExpression(exprs[i]!)
      builder.emit(Op.TO_STRING, 0, 0, idx(exprs[i]), 0)
      parts++
    })
    if (parts > 1) builder.emit(Op.CONCAT, 0, parts, idx(node), 1 - parts)
  }

  const compileTaggedTemplate = (node: TaggedTemplateExpression): void => {
    if (node.tag.type === "MemberExpression") compileMemberExpression(node.tag, true)
    else {
      builder.emit(Op.PUSH_UNDEF, 0, 0, idx(node), 1)
      compileExpression(node.tag)
    }
    const siteConst = builder.constant({
      cooked: node.quasi.quasis.map((q) => q.value.cooked ?? undefined),
      raw: node.quasi.quasis.map((q) => q.value.raw),
      nodeIndex: idx(node),
    })
    const argc = 1 + node.quasi.expressions.length
    if (argc <= 254) {
      builder.emit(Op.TEMPLATE, 0, siteConst, idx(node), 1)
      for (const expr of node.quasi.expressions) compileExpression(expr)
      builder.emit(Op.CALL, argc, 0, idx(node), -(argc + 1))
      return
    }
    builder.emit(Op.NEW_ARRAY, 0, 0, idx(node), 1)
    builder.emit(Op.TEMPLATE, 0, siteConst, idx(node), 1)
    builder.emit(Op.ARRAY_APPEND, 0, 0, idx(node), -1)
    for (const expr of node.quasi.expressions) {
      compileExpression(expr)
      builder.emit(Op.ARRAY_APPEND, 0, 0, idx(expr), -1)
    }
    builder.emit(Op.CALL_SPREAD, 0, 0, idx(node), -2)
  }

  const compileUnaryExpression = (node: UnaryExpression): void => {
    const op = node.operator
    if (op === "delete") return compileDeleteExpression(node)
    const ref = node.argument.type === "Identifier" ? analysis.refs.get(node.argument)! : undefined
    if (op === "typeof" && ref?.kind === "global") return emitLoadRef(ref, node.argument, true)
    compileExpression(node.argument)
    if (op === "!") builder.emit(Op.NOT, 0, 0, idx(node), 0)
    else builder.emit(Op.UNARY, UnaryOps[op]!, 0, idx(node), 0)
  }

  const compileDeleteExpression = (node: UnaryExpression): void => {
    const arg = node.argument
    const isChain = arg.type === "ChainExpression"
    const target = isChain ? arg.expression : arg
    if (target.type === "Identifier") {
      return emitThrowError({ type: "TypeError", message: "Only data fields may be deleted." }, target)
    }
    if (target.type !== "MemberExpression") {
      compileExpression(arg)
      builder.emit(Op.POP, 0, 0, idx(node), -1)
      builder.emit(Op.PUSH_BOOL, 1, 0, idx(node), 1)
      return
    }
    if (unsupportedSuper(target)) return
    const shortLabel = isChain || target.optional ? builder.newLabel(builder.depth + 1) : undefined
    compileExpression(target.object as Expression, shortLabel)
    if (target.optional && shortLabel) {
      builder.emitJump(Op.JUMP_COND, CondKind.NULLISH, shortLabel, idx(target), 0, 0)
    }
    if (target.computed) {
      compileExpression(target.property as Expression)
      builder.emit(Op.DELETE_ELEM, 0, 0, idx(target), -1)
    } else builder.emit(Op.DELETE_PROP, 0, builder.constant(propertyName(target)), idx(target), 0)
    if (shortLabel && shortLabel.patches.length > 0) {
      const endLabel = builder.newLabel(builder.depth)
      builder.emitJump(Op.JUMP, 0, endLabel, idx(node), 0, 0)
      builder.mark(shortLabel)
      builder.emit(Op.POP, 0, 0, idx(node), -1)
      builder.emit(Op.PUSH_BOOL, 1, 0, idx(node), 1)
      builder.mark(endLabel)
    }
  }

  const compileUpdateExpression = (node: UpdateExpression): void => {
    const incFlag = node.operator === "++" ? 0 : 1
    const arg = node.argument
    if (arg.type === "Identifier") {
      const ref = analysis.refs.get(arg)!
      emitLoadRef(ref, arg)
      if (node.prefix) builder.emit(Op.INC, incFlag, 0, idx(node), 0)
      else builder.emit(Op.TO_NUMERIC, incFlag, 0, idx(arg), 0)
      builder.emit(Op.DUP, 0, 0, idx(node), 1)
      if (!node.prefix) builder.emit(Op.INC, incFlag, 0, idx(node), 0)
      emitStoreRef(ref, false, arg)
      return
    }
    if (arg.type !== "MemberExpression") {
      return emitThrowError(
        { type: "TypeError", message: "Update target must be an Identifier or MemberExpression." },
        arg,
      )
    }
    if (unsupportedSuper(arg)) return
    compileExpression(arg.object as Expression)
    const k = arg.computed ? 0 : builder.constant(propertyName(arg))
    if (arg.computed) {
      compileExpression(arg.property as Expression)
      emitWritableKey(arg)
      builder.emit(Op.PICK, 1, 0, idx(arg), 1)
      builder.emit(Op.PICK, 1, 0, idx(arg), 1)
      builder.emit(Op.GET_ELEM, 0, 0, idx(arg), -1)
    } else {
      builder.emit(Op.CHECK_BASE, CheckBaseKind.WRITE_PROP, k, idx(arg), 0)
      builder.emit(Op.DUP, 0, 0, idx(arg), 1)
      builder.emit(Op.GET_PROP, 0, k, idx(arg), 0)
    }
    builder.emit(Op.TO_NUMERIC, incFlag, 0, idx(arg), 0)
    if (!node.prefix) {
      builder.emit(Op.DUP, 0, 0, idx(node), 1)
      builder.emit(Op.ROT, arg.computed ? 3 : 2, 0, idx(node), 0)
    }
    builder.emit(Op.INC, incFlag, 0, idx(node), 0)
    if (arg.computed) builder.emit(Op.PUT_ELEM, 0, 0, idx(arg), -2)
    else builder.emit(Op.PUT_PROP, 0, k, idx(arg), -1)
    if (!node.prefix) builder.emit(Op.POP, 0, 0, idx(node), -1)
  }

  const emitBinaryOp = (op: string, node: AstNode): void => {
    const [code, a] = BinaryOps[op]!
    builder.emit(code, a, 0, idx(node), -1)
  }

  const compileBinaryExpression = (node: BinaryExpression): void => {
    compileExpression(node.left as Expression)
    compileExpression(node.right)
    emitBinaryOp(node.operator, node)
  }

  const compileLogicalExpression = (node: LogicalExpression): void => {
    const endLabel = builder.newLabel(builder.depth + 1)
    compileExpression(node.left)
    builder.emitJump(Op.JUMP_COND, logicalCond(node.operator), endLabel, idx(node), 0, -1)
    compileExpression(node.right)
    builder.mark(endLabel)
  }

  const compileConditionalExpression = (node: ConditionalExpression): void => {
    const elseLabel = builder.newLabel(builder.depth)
    const endLabel = builder.newLabel(builder.depth + 1)
    compileExpression(node.test)
    builder.emitJump(Op.JUMP_IF_FALSE, 0, elseLabel, idx(node), -1, -1)
    compileExpression(node.consequent)
    builder.emitJump(Op.JUMP, 0, endLabel, idx(node), 0, -1)
    builder.mark(elseLabel)
    compileExpression(node.alternate)
    builder.mark(endLabel)
  }

  const isLogicalAssignment = (node: AssignmentExpression) =>
    node.operator === "&&=" || node.operator === "||=" || node.operator === "??="

  // `discard` skips keeping the assigned value, for an assignment to an identifier used as a statement.
  const compileAssignmentExpression = (node: AssignmentExpression, discard = false): void => {
    const left = node.left
    const op = node.operator
    const isLogical = isLogicalAssignment(node)

    if (left.type === "Identifier") {
      const ref = analysis.refs.get(left)!
      const endLabel = builder.newLabel(builder.depth + 1)
      if (op !== "=") emitLoadRef(ref, left)
      if (isLogical) builder.emitJump(Op.JUMP_COND, logicalCond(op), endLabel, idx(node), 0, -1)
      if (op === "=" || isLogical) compileNamedExpression(node.right, left.name)
      else {
        compileExpression(node.right)
        emitBinaryOp(op.slice(0, -1), node)
      }
      if (!discard) builder.emit(Op.DUP, 0, 0, idx(node), 1)
      emitStoreRef(ref, false, left)
      if (isLogical) builder.mark(endLabel)
      return
    }

    if (left.type === "ObjectPattern" || left.type === "ArrayPattern") {
      compileExpression(node.right)
      builder.emit(Op.DUP, 0, 0, idx(node), 1)
      compilePattern(left, false, false, node)
      return
    }

    if (left.type !== "MemberExpression") {
      return emitThrowError(
        { type: "TypeError", message: "Assignment target must be an Identifier or MemberExpression." },
        left,
      )
    }
    if (unsupportedSuper(left)) return

    const baseDepth = builder.depth
    compileExpression(left.object as Expression)
    const k = left.computed ? 0 : builder.constant(propertyName(left))
    const put = () =>
      left.computed ? builder.emit(Op.PUT_ELEM, 0, 0, idx(left), -2) : builder.emit(Op.PUT_PROP, 0, k, idx(left), -1)
    if (left.computed) {
      compileExpression(left.property as Expression)
      emitWritableKey(left)
    } else builder.emit(Op.CHECK_BASE, CheckBaseKind.WRITE_PROP, k, idx(left), 0)
    if (op === "=") {
      compileExpression(node.right)
      put()
      return
    }
    if (left.computed) {
      builder.emit(Op.PICK, 1, 0, idx(left), 1)
      builder.emit(Op.PICK, 1, 0, idx(left), 1)
      builder.emit(Op.GET_ELEM, 0, 0, idx(left), -1)
    } else {
      builder.emit(Op.DUP, 0, 0, idx(left), 1)
      builder.emit(Op.GET_PROP, 0, k, idx(left), 0)
    }
    if (!isLogical) {
      compileExpression(node.right)
      emitBinaryOp(op.slice(0, -1), node)
      put()
      return
    }
    // Short-circuits with `[o, key, current]` (or `[o, current]`) on the stack, and keeps `current`.
    const shortLabel = builder.newLabel(baseDepth + (left.computed ? 3 : 2))
    const endLabel = builder.newLabel(baseDepth + 1)
    builder.emitJump(Op.JUMP_COND, logicalCond(op), shortLabel, idx(node), 0, -1)
    compileExpression(node.right)
    put()
    builder.emitJump(Op.JUMP, 0, endLabel, idx(node), 0, -1)
    builder.mark(shortLabel)
    builder.emit(Op.ROT, left.computed ? 2 : 1, 0, idx(node), 0)
    builder.emit(Op.POP, 0, 0, idx(node), -1)
    if (left.computed) builder.emit(Op.POP, 0, 0, idx(node), -1)
    builder.mark(endLabel)
  }

  const compileMemberExpression = (node: MemberExpression, keepReceiver: boolean, chainShortCircuit?: Label): void => {
    if (unsupportedSuper(node)) return
    compileExpression(node.object as Expression, chainShortCircuit)
    if (node.optional && chainShortCircuit) {
      builder.emitJump(Op.JUMP_COND, CondKind.NULLISH, chainShortCircuit, idx(node), 0, 0)
    }
    const keepFlag = keepReceiver ? 1 : 0
    if (node.computed) {
      compileExpression(node.property as Expression)
      if (keepReceiver) {
        builder.emit(Op.CHECK_BASE, CheckBaseKind.READ, 0, idx(node), 0)
        builder.emit(Op.TO_KEY, 0, 0, idx(node.property), 0)
      }
      builder.emit(Op.GET_ELEM, keepFlag, 0, idx(node), keepReceiver ? 0 : -1)
    } else {
      builder.emit(Op.GET_PROP, keepFlag, builder.constant(propertyName(node)), idx(node), keepReceiver ? 1 : 0)
    }
  }

  const compileCallExpression = (node: CallExpression, chainShortCircuit?: Label): void => {
    if (node.callee.type === "Super") return emitUnsupported("Super", node.callee)
    const args = node.arguments
    // Lower `$Call(fn, thisArg, ...args)` in internal/prelude code directly to `Op.CALL` (§5.1)
    if (
      internal &&
      !node.optional &&
      node.callee.type === "Identifier" &&
      node.callee.name === "$Call" &&
      args.length >= 2 &&
      args.length - 2 <= 254 &&
      !args.some((a) => a.type === "SpreadElement")
    ) {
      for (const arg of [args[1]!, args[0]!, ...args.slice(2)]) compileExpression(arg as Expression)
      builder.emit(Op.CALL, args.length - 2, 0, idx(node), -(args.length - 1))
      return
    }
    const shortLabel = chainShortCircuit ?? (node.optional ? builder.newLabel(builder.depth + 1) : undefined)
    if (node.callee.type === "MemberExpression") {
      compileMemberExpression(node.callee, true, shortLabel)
      if (node.optional && shortLabel) {
        builder.emitJump(Op.JUMP_COND, CondKind.NULLISH_METHOD, shortLabel, idx(node), -1, 0)
      }
    } else if (shortLabel) {
      compileExpression(node.callee, shortLabel)
      if (node.optional) builder.emitJump(Op.JUMP_COND, CondKind.NULLISH, shortLabel, idx(node), 0, 0)
      builder.emit(Op.PUSH_UNDEF, 0, 0, idx(node), 1)
      builder.emit(Op.ROT, 1, 0, idx(node), 0)
    } else {
      builder.emit(Op.PUSH_UNDEF, 0, 0, idx(node), 1)
      compileExpression(node.callee)
    }
    if (emitArguments(args, node)) builder.emit(Op.CALL_SPREAD, 0, 0, idx(node), -2)
    else builder.emit(Op.CALL, args.length, 0, idx(node), -(args.length + 1))
    if (!chainShortCircuit && shortLabel) builder.mark(shortLabel)
  }

  const compileNewExpression = (node: NewExpression): void => {
    compileExpression(node.callee as Expression)
    // Check constructibility before evaluating arguments
    builder.emit(Op.NEW, 255, 0, idx(node), 0)
    const args = node.arguments
    if (emitArguments(args, node)) builder.emit(Op.NEW_SPREAD, 0, 0, idx(node), -1)
    else builder.emit(Op.NEW, args.length, 0, idx(node), -args.length)
  }

  const compileImportExpression = (node: ImportExpression): void => {
    compileExpression(node.source)
    builder.emit(Op.TO_STRING, 1, 0, idx(node.source), 0)
    if (node.options) {
      compileExpression(node.options)
      builder.emit(Op.POP, 0, 0, idx(node.options), -1)
    }
    builder.emit(Op.IMPORT, ImportKind.DYNAMIC, 0, idx(node), 0)
  }

  const compileAwaitExpression = (node: AwaitExpression): void => {
    compileExpression(node.argument)
    builder.emit(Op.AWAIT, internal ? 1 : 0, 0, idx(node), 0)
  }

  const isAsync = (fnInfo.flags & CodeFlags.ASYNC) !== 0

  const compileYieldExpression = (node: YieldExpression): void => {
    if (node.delegate) return compileYieldDelegate(node)
    const targetDepth = builder.depth + 1
    if (node.argument) compileExpression(node.argument)
    else builder.emit(Op.PUSH_UNDEF, 0, 0, idx(node), 1)
    if (isAsync) builder.emit(Op.AWAIT, 0, 0, idx(node), 0)
    builder.emit(Op.YIELD, 0, 0, idx(node), 1)
    // C2: RESUME jumps to `normalLabel` on next (`[recv]`), throws on throw, and falls through on return (`[recv]`).
    const normalLabel = builder.newLabel(targetDepth)
    builder.emitJump(Op.RESUME, 0, normalLabel, idx(node), -1, -1)
    if (isAsync) builder.emit(Op.AWAIT, 1, 0, idx(node), 0)
    exitPlan("return", null, node)
    builder.mark(normalLabel)
  }

  // Pushes whether the resume kind in `kindSlot` (or on top, when `kindSlot` is -1) is `return`.
  const emitIsReturn = (kindSlot: number, node: AstNode): void => {
    if (kindSlot < 0) builder.emit(Op.DUP, 0, 0, idx(node), 1)
    else builder.emit(Op.GET_LOCAL, 0, kindSlot, idx(node), 1)
    builder.emitNumber(2, idx(node))
    builder.emit(Op.SEQ, 0, 0, idx(node), -1)
  }

  const compileYieldDelegate = (node: YieldExpression): void => {
    const baseDepth = builder.depth
    const itSlot = allocSlot("%it")
    const kindSlot = allocSlot("%kind")
    compileExpression(node.argument!)
    const openSlow = emitIterOpen(isAsync ? IterContext.ASYNC_DELEGATE : IterContext.DELEGATE, itSlot, baseDepth, node)
    builder.emit(Op.PUSH_UNDEF, 0, 0, idx(node), 1)
    builder.emitNumber(0, idx(node))

    const loopLabel = builder.newLabel(baseDepth + 2)
    const callLabel = builder.newLabel(baseDepth + 3)
    const noThrowLabel = builder.newLabel(baseDepth + 1)
    const doneLabel = builder.newLabel(baseDepth + 1)
    const exprDoneLabel = builder.newLabel(baseDepth + 1)

    builder.mark(loopLabel)
    builder.emit(Op.DUP, 0, 0, idx(node), 1)
    builder.emit(Op.PUT_LOCAL, PutKind.INIT, kindSlot, idx(node), -1)
    // YSTAR jumps to `callLabel` (`[iterator, method, recv]`) when the method exists, and falls through (`[recv]`) when missing.
    builder.emitJump(Op.YSTAR, itSlot, callLabel, idx(node), 1, -1)
    emitIsReturn(kindSlot, node)
    builder.emitJump(Op.JUMP_IF_FALSE, 0, noThrowLabel, idx(node), -1, -1)
    // Missing `return` method: await received value in async generators, then return
    if (isAsync) builder.emit(Op.AWAIT, 0, 0, idx(node), 0)
    exitPlan("return", null, node)

    // Missing `throw` method: close iterator, then throw TypeError
    builder.mark(noThrowLabel)
    builder.emit(Op.POP, 0, 0, idx(node), -1)
    emitIteratorCloseNormal(itSlot, isAsync, node)
    emitThrowError({ type: "TypeError", message: "The delegated iterator does not provide a throw() method." }, node)

    builder.mark(callLabel)
    builder.emit(Op.CALL, 1, 0, idx(node), -2)
    if (isAsync) builder.emit(Op.AWAIT, 0, 0, idx(node), 0)
    builder.emitJump(Op.YSTAR_RESULT, kindSlot, doneLabel, idx(node), 0, 0)
    builder.emit(Op.YIELD, 0, 0, idx(node), 1)
    if (isAsync) {
      const notReturnLabel = builder.newLabel(baseDepth + 2)
      emitIsReturn(-1, node)
      builder.emitJump(Op.JUMP_IF_FALSE, 0, notReturnLabel, idx(node), -1, -1)
      builder.emit(Op.ROT, 1, 0, idx(node), 0)
      builder.emit(Op.AWAIT, 1, 0, idx(node), 0)
      builder.emit(Op.ROT, 1, 0, idx(node), 0)
      builder.mark(notReturnLabel)
    }
    builder.emitJump(Op.LOOP, 0, loopLabel, idx(node), 0, null)
    openSlow()

    builder.mark(doneLabel)
    emitIsReturn(kindSlot, node)
    builder.emitJump(Op.JUMP_IF_FALSE, 0, exprDoneLabel, idx(node), -1, -1)
    exitPlan("return", null, node)
    builder.mark(exprDoneLabel)
  }

  type Compilers<N extends { type: string }, A> = {
    readonly [K in N["type"]]?: (node: Extract<N, { type: K }>, arg?: A) => void
  }

  const statements: Compilers<Statement | ModuleDeclaration, Set<string>> = {
    EmptyStatement: () => {},
    FunctionDeclaration: () => {},
    ImportDeclaration: (stmt) => {
      if (isProgram) return
      const message = "An import declaration may only appear at the top level of the program."
      emitThrowError({ type: "SyntaxError", message }, stmt)
    },
    ExpressionStatement: (stmt) => compileEffect(stmt.expression),
    VariableDeclaration: compileVariableDeclaration,
    BlockStatement: compileBlockStatement,
    IfStatement: compileIfStatement,
    WhileStatement: compileWhileStatement,
    DoWhileStatement: compileDoWhileStatement,
    ForStatement: compileForStatement,
    ForInStatement: compileForInStatement,
    ForOfStatement: compileForOfStatement,
    SwitchStatement: compileSwitchStatement,
    LabeledStatement: compileLabeledStatement,
    BreakStatement: (stmt) => exitPlan("break", findExitTarget("break", stmt.label?.name), stmt),
    ContinueStatement: (stmt) => exitPlan("continue", findExitTarget("continue", stmt.label?.name), stmt),
    ReturnStatement: (stmt) => {
      if (stmt.argument) {
        compileExpression(stmt.argument)
        if (isAsync && (fnInfo.flags & CodeFlags.GENERATOR) !== 0) builder.emit(Op.AWAIT, 0, 0, idx(stmt), 0)
      } else builder.emit(Op.PUSH_UNDEF, 0, 0, idx(stmt), 1)
      exitPlan("return", null, stmt)
    },
    ThrowStatement: (stmt) => {
      compileExpression(stmt.argument)
      builder.emit(Op.THROW, 0, 0, idx(stmt), -1)
      builder.unreachable()
    },
    TryStatement: compileTryStatement,
  }

  const expressions: Compilers<Expression, Label> = {
    Literal: compileLiteral,
    Identifier: (expr) => emitLoadRef(analysis.refs.get(expr)!, expr),
    ThisExpression: (expr) => emitLoadRef(analysis.thisRefs.get(expr)!, expr),
    FunctionExpression: (expr) => builder.emit(Op.CLOSURE, 0, analysis.nodeToFunction.get(expr)!.index, idx(expr), 1),
    ArrowFunctionExpression: (expr) =>
      builder.emit(Op.CLOSURE, 0, analysis.nodeToFunction.get(expr)!.index, idx(expr), 1),
    ArrayExpression: compileArrayExpression,
    ObjectExpression: compileObjectExpression,
    TemplateLiteral: compileTemplateLiteral,
    TaggedTemplateExpression: compileTaggedTemplate,
    UnaryExpression: compileUnaryExpression,
    UpdateExpression: compileUpdateExpression,
    BinaryExpression: compileBinaryExpression,
    LogicalExpression: compileLogicalExpression,
    ConditionalExpression: compileConditionalExpression,
    SequenceExpression: (expr) =>
      expr.expressions.forEach((e, i) => {
        compileExpression(e)
        if (i < expr.expressions.length - 1) builder.emit(Op.POP, 0, 0, idx(e), -1)
      }),
    AssignmentExpression: (expr) => compileAssignmentExpression(expr),
    MemberExpression: (expr, short) => compileMemberExpression(expr, false, short),
    CallExpression: compileCallExpression,
    NewExpression: compileNewExpression,
    ChainExpression: (expr) => {
      const shortLabel = builder.newLabel(builder.depth + 1)
      compileExpression(expr.expression, shortLabel)
      builder.mark(shortLabel)
    },
    ImportExpression: compileImportExpression,
    AwaitExpression: compileAwaitExpression,
    YieldExpression: compileYieldExpression,
  }

  // --- Emit Function / Program Body ---
  // `this`, `arguments`, and a named function expression's own name, when the body uses them.
  const emitImplicit = (decl: Decl | undefined, argsKind: number): void => {
    if (!decl?.used) return
    if (decl.captured) builder.emit(Op.NEW_CELL, 0, decl.slot)
    if (isProgram) builder.emit(Op.PUSH_UNDEF, 0, 0, -1, 1)
    else builder.emit(Op.ARGS, argsKind, 0, idx(fnInfo.node), 1)
    emitStoreDecl(decl, true, isProgram ? undefined : fnInfo.node)
  }

  if (isProgram) {
    const prog = fnInfo.node as Program
    emitImplicit(fnInfo.thisDecl, 3)
    for (const decl of fnInfo.bodyScope.decls.values()) {
      if (decl.kind !== "this" && decl.captured) builder.emit(Op.NEW_CELL, 0, decl.slot)
    }
    emitImports(prog.body)
    for (const decl of fnInfo.bodyScope.decls.values()) {
      if (decl.kind !== "var") continue
      builder.emit(Op.PUSH_UNDEF, 0, 0, -1, 1)
      emitStoreDecl(decl, true)
    }
    emitHoistedFunctions(fnInfo.bodyScope)
    const last = prog.body.at(-1)
    for (const s of prog.body) if (s !== last || s.type !== "ExpressionStatement") compileStatement(s)
    if (last?.type === "ExpressionStatement") {
      compileExpression(last.expression)
      builder.emit(Op.END_PROGRAM, 0, 0, idx(last), -1)
    } else {
      builder.emit(Op.PUSH_UNDEF, 0, 0, idx(prog), 1)
      builder.emit(Op.END_PROGRAM, 0, 0, idx(prog), -1)
    }
  } else {
    emitImplicit(fnInfo.selfScope?.decls.values().next().value, 2)
    emitImplicit(fnInfo.thisDecl, 3)
    const simple = (fnInfo.flags & CodeFlags.SIMPLE_PARAMS) !== 0
    for (const decl of fnInfo.paramScope.decls.values()) {
      // A simple parameter's argument is already in its slot: it moves into the new cell.
      if (decl.kind === "param" && decl.captured)
        builder.emit(Op.NEW_CELL, simple ? 1 : 0, decl.slot, idx(fnInfo.node), 0)
    }
    emitImplicit(fnInfo.argumentsDecl, 0)
    if (!simple) {
      fnInfo.params.forEach((param, i) => {
        if (param.type === "RestElement") {
          builder.emit(Op.ARGS, 1, i, idx(param), 1)
          return compilePattern(param.argument, true, true, param)
        }
        // Duplicate plain identifier parameter: only the last occurrence initializes the binding
        const name = param.type === "Identifier" ? param.name : undefined
        if (name !== undefined && fnInfo.params.findLastIndex((p) => p.type === "Identifier" && p.name === name) !== i)
          return
        builder.emit(Op.ARGS, 4, i, idx(param), 1)
        compilePattern(param, true, true, param)
      })
    }
    emitScopePrologue(fnInfo.bodyScope, false)
    if ((fnInfo.flags & CodeFlags.GENERATOR) !== 0) builder.emit(Op.GENERATOR_START, 0, 0, idx(fnInfo.node), 0)

    const body = fnInfo.node.body as BlockStatement | Expression
    if (body.type === "BlockStatement") {
      for (const s of body.body) compileStatement(s)
      builder.emit(Op.PUSH_UNDEF, 0, 0, idx(body), 1)
    } else compileExpression(body)
    builder.emit(Op.RETURN, 0, 0, idx(body), -1)
  }

  return builder.finish()
}

const propertyName = (node: MemberExpression): string => (node.property as { name: string }).name

const keyName = (key: Expression | { type: "PrivateIdentifier" }): string =>
  key.type === "Identifier" ? key.name : String((key as Literal).value)
