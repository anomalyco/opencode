import type { AstNode } from "./runtime/model.js"
import type { Source } from "./runtime/source.js"
import { type ConstValue, Op, type OpCode, packWord } from "./opcodes.js"

type SourceRef = {
  readonly id: string
  readonly hash: string
}

export type Label = {
  pc: number
  readonly patches: Array<number>
  depth: number | undefined
}

/**
 * Immutable compiled function or program body. Holds no per-run mutable state.
 */
export class Code {
  readonly source: SourceRef
  readonly index: number
  readonly name: string
  readonly flags: number
  readonly length: number
  readonly params: number
  readonly locals: number
  readonly maxStack: number
  readonly code: Int32Array
  readonly consts: ReadonlyArray<ConstValue>
  /** Per upvalue: `[from (0 = parent cell slot, 1 = parent upvalue), index]`. */
  readonly captures: Int32Array
  /** Exception handlers `[start, end, target, depth]*`, innermost first (`end` exclusive). */
  readonly handlers: Int32Array
  /** Per finally level: `[tagSlot, valSlot, entryDepth, n, target_0 … target_{n-1}]`. */
  readonly finallies: Int32Array
  /** Offsets into `finallies` indexed by finally level. */
  readonly finallyOffsets: Int32Array
  /** Run-length encoded `[pc, nodeIndex]*` sorted by `pc`. */
  readonly sites: Int32Array
  readonly localNames: ReadonlyArray<string>
  readonly upvalNames: ReadonlyArray<string>
  readonly sourceObj: Source | undefined

  constructor(init: {
    readonly source: SourceRef
    readonly index: number
    readonly name: string
    readonly flags: number
    readonly length: number
    readonly params: number
    readonly locals: number
    readonly maxStack: number
    readonly code: Int32Array
    readonly consts: ReadonlyArray<ConstValue>
    readonly captures: Int32Array
    readonly handlers: Int32Array
    readonly finallies: Int32Array
    readonly finallyOffsets: Int32Array
    readonly sites: Int32Array
    readonly localNames: ReadonlyArray<string>
    readonly upvalNames?: ReadonlyArray<string> | undefined
    readonly sourceObj?: Source | undefined
  }) {
    this.source = init.source
    this.index = init.index
    this.name = init.name
    this.flags = init.flags
    this.length = init.length
    this.params = init.params
    this.locals = init.locals
    this.maxStack = init.maxStack
    this.code = init.code
    const consts: Array<ConstValue> = [""]
    consts.pop()
    for (let i = 0; i < init.consts.length; i++) consts.push(init.consts[i]!)
    this.consts = consts
    this.captures = init.captures
    this.handlers = init.handlers
    this.finallies = init.finallies
    this.finallyOffsets = init.finallyOffsets
    this.sites = init.sites
    this.localNames = init.localNames
    this.upvalNames = init.upvalNames ?? []
    this.sourceObj = init.sourceObj
  }

  /** Resolves the AST node index recorded for `pc`, or `-1` when none was recorded. */
  nodeIndexAt(pc: number): number {
    const sites = this.sites
    const count = sites.length >>> 1
    if (count === 0) return -1
    let low = 0
    let high = count - 1
    let best = -1
    while (low <= high) {
      const mid = (low + high) >>> 1
      const entryPc = sites[mid << 1]!
      if (entryPc <= pc) {
        best = sites[(mid << 1) + 1]!
        low = mid + 1
      } else {
        high = mid - 1
      }
    }
    return best
  }

  /** Resolves the AST node recorded for `pc`. */
  siteAt(pc: number): AstNode | undefined {
    const index = this.nodeIndexAt(pc)
    return index >= 0 ? this.sourceObj?.nodes[index] : undefined
  }

  /** The same code over another parse of its source, so its sites resolve to that tree's nodes. */
  withSource(sourceObj: Source): Code {
    return new Code({ ...this, sourceObj })
  }
}

// The fields of a `Code` that are packed words.
const words = ["code", "captures", "handlers", "finallies", "finallyOffsets", "sites"] as const

export type CodeJson = { readonly [field: string]: unknown }

/** Code as JSON, for bytecode compiled ahead of time: every field but the source tree, which `codeFromJson` is given. */
export const codeToJson = (code: Code): CodeJson => {
  const { sourceObj: _, ...fields } = code
  return { ...fields, ...Object.fromEntries(words.map((field) => [field, [...code[field]]])) }
}

export const codeFromJson = (data: CodeJson, sourceObj: Source): Code =>
  new Code({
    ...(data as unknown as ConstructorParameters<typeof Code>[0]),
    ...Object.fromEntries(words.map((field) => [field, Int32Array.from(data[field] as Array<number>)])),
    sourceObj,
  })

/** Raised when a narrow-jump function exceeds 16-bit jump range (`65,535` words) and must recompile in wide mode. */
export class CodeSizeOverflow extends RangeError {
  constructor(message = "Function bytecode exceeds 16-bit jump range") {
    super(message)
    this.name = "CodeSizeOverflow"
  }
}

const checkUint31 = (value: number, name: string): void => {
  if (!Number.isInteger(value) || value < 0 || value > 0x7fffffff) {
    throw new RangeError(`${name} out of range: ${value}`)
  }
}

export class CodeBuilder {
  private readonly words: Array<number> = []
  private readonly sitePairs: Array<number> = []
  private lastNodeIndex = -2
  private readonly constList: Array<ConstValue> = []
  // Strings and numbers (but -0) are pooled; other constants are each their own.
  private readonly pooled = new Map<string | number, number>()
  private readonly handlerWords: Array<number> = []
  private readonly finallyWords: Array<number> = []
  private readonly finallyLevelOffsets: Array<number> = []

  depth = 0
  maxStack = 0
  wideJumps = false
  forceExtra = false

  constructor(
    readonly source: SourceRef,
    readonly sourceObj: Source | undefined,
    readonly index: number,
    readonly name: string,
    public flags: number,
    readonly length: number,
    readonly params: number,
    public locals: number,
    readonly localNames: Array<string>,
    readonly captures: Int32Array,
    readonly upvalNames: ReadonlyArray<string> = [],
  ) {}

  get pc(): number {
    return this.words.length
  }

  adjustDepth(delta: number): void {
    if (this.depth < 0) return
    this.depth += delta
    if (this.depth > this.maxStack) this.maxStack = this.depth
  }

  setDepth(depth: number): void {
    this.depth = depth
    if (this.depth > this.maxStack) this.maxStack = this.depth
  }

  unreachable(): void {
    this.depth = -1
  }

  constant(value: ConstValue): number {
    const poolable = typeof value === "string" || (typeof value === "number" && !Object.is(value, -0))
    const existing = poolable ? this.pooled.get(value) : undefined
    if (existing !== undefined) return existing
    const k = this.constList.length
    checkUint31(k, "Constant index")
    if (poolable) this.pooled.set(value, k)
    this.constList.push(value)
    return k
  }

  private recordSite(pc: number, nodeIndex: number): void {
    if (nodeIndex < 0 || nodeIndex === this.lastNodeIndex) return
    this.sitePairs.push(pc, nodeIndex)
    this.lastNodeIndex = nodeIndex
  }

  private pushOp(op: OpCode, a: number, bx: number, nodeIndex: number, forceWide: boolean): number {
    if ((op & 0xff) !== op || op === Op.EXTRA) {
      throw new RangeError(`Invalid opcode: ${op}`)
    }
    checkUint31(a, "Operand a")
    if (op === Op.NEW && a > 0xff) {
      throw new RangeError(`Op.NEW operand a out of range: ${a}`)
    }
    if (op === Op.PUSH_INT) {
      if (a !== 0 || (bx & 0xffff) !== bx) {
        throw new RangeError(`Op.PUSH_INT operand out of range: a=${a} bx=${bx}`)
      }
    } else {
      checkUint31(bx, "Operand bx")
    }
    if (a > 0xffff) {
      this.recordSite(this.words.length, nodeIndex)
      this.words.push(packWord(Op.EXTRA, 0, a >>> 16))
      this.words.push(packWord(Op.EXTRA, (a >>> 8) & 0xff, bx >>> 16))
    } else if (forceWide || a > 0xff || (op !== Op.PUSH_INT && bx > 0xffff)) {
      this.recordSite(this.words.length, nodeIndex)
      this.words.push(packWord(Op.EXTRA, a >>> 8, bx >>> 16))
    }
    const pc = this.words.length
    this.recordSite(pc, nodeIndex)
    this.words.push(packWord(op, a & 0xff, bx & 0xffff))
    if (this.words.length > 0x7fffffff) {
      throw new RangeError(`Bytecode length ${this.words.length} exceeds 31-bit limit`)
    }
    if (!this.wideJumps && !this.forceExtra && this.words.length > 0xffff) {
      throw new CodeSizeOverflow()
    }
    return pc
  }

  emit(op: OpCode, a = 0, bx = 0, nodeIndex = -1, stackDelta = 0): number {
    if (this.depth < 0) return this.words.length
    const pc = this.pushOp(op, a, bx, nodeIndex, this.forceExtra)
    this.adjustDepth(stackDelta)
    return pc
  }

  emitNumber(value: number, nodeIndex = -1): void {
    if (this.depth < 0) return
    if (Number.isInteger(value) && !Object.is(value, -0) && value >= -32768 && value <= 32767 && !this.forceExtra) {
      this.emit(Op.PUSH_INT, 0, value & 0xffff, nodeIndex, 1)
      return
    }
    const k = this.constant(value)
    this.emit(Op.PUSH_CONST, 0, k, nodeIndex, 1)
  }

  emitString(value: string, nodeIndex = -1): void {
    if (this.depth < 0) return
    const k = this.constant(value)
    this.emit(Op.PUSH_CONST, 0, k, nodeIndex, 1)
  }

  newLabel(depth?: number): Label {
    return { pc: -1, patches: [], depth }
  }

  mark(label: Label): void {
    const target = this.words.length
    checkUint31(target, "Jump target")
    label.pc = target
    if (label.depth !== undefined) this.setDepth(label.depth)
    else if (this.depth >= 0) label.depth = this.depth
    for (const patchPc of label.patches) {
      const hasExtra = patchPc > 0 && (this.words[patchPc - 1]! & 0xff) === Op.EXTRA
      if (!hasExtra) {
        if (target > 0xffff) throw new CodeSizeOverflow()
        this.words[patchPc] = (this.words[patchPc]! & 0xffff) | (target << 16)
      } else {
        this.words[patchPc - 1] = (this.words[patchPc - 1]! & 0xffff) | ((target >>> 16) << 16)
        this.words[patchPc] = (this.words[patchPc]! & 0xffff) | ((target & 0xffff) << 16)
      }
    }
    label.patches.length = 0
  }

  emitJump(op: OpCode, a: number, label: Label, nodeIndex = -1, jumpDelta = 0, fallDelta: number | null = 0): void {
    if (this.depth < 0) return
    const targetDepth = this.depth + jumpDelta
    if (label.depth === undefined) label.depth = targetDepth
    const known = label.pc >= 0
    if (known && !this.wideJumps && !this.forceExtra && label.pc > 0xffff) {
      throw new CodeSizeOverflow()
    }
    const pc = this.pushOp(op, a, known ? label.pc : 0, nodeIndex, this.wideJumps || this.forceExtra)
    if (!known) label.patches.push(pc)
    if (fallDelta === null) this.depth = -1
    else this.adjustDepth(fallDelta)
  }

  addHandler(start: number, end: number, target: number, depth: number): void {
    if (start >= end || target < 0) return
    checkUint31(start, "Handler start")
    checkUint31(end, "Handler end")
    checkUint31(target, "Handler target")
    checkUint31(depth, "Handler depth")
    this.handlerWords.push(start, end, target, depth)
  }

  reserveFinally(): number {
    const level = this.finallyLevelOffsets.length
    checkUint31(level, "Finally level")
    this.finallyLevelOffsets.push(-1)
    return level
  }

  setFinally(
    level: number,
    tagSlot: number,
    valSlot: number,
    entryDepth: number,
    targets: ReadonlyArray<number>,
  ): void {
    checkUint31(level, "Finally level")
    checkUint31(tagSlot, "Finally tagSlot")
    checkUint31(valSlot, "Finally valSlot")
    checkUint31(entryDepth, "Finally entryDepth")
    checkUint31(targets.length, "Finally target count")
    this.finallyLevelOffsets[level] = this.finallyWords.length
    this.finallyWords.push(tagSlot, valSlot, entryDepth, targets.length)
    for (const t of targets) {
      if (!Number.isInteger(t) || t < -1 || t > 0x7fffffff) {
        throw new RangeError(`Finally target out of range: ${t}`)
      }
      this.finallyWords.push(t)
    }
  }

  finish(): Code {
    return new Code({
      source: this.source,
      index: this.index,
      name: this.name,
      flags: this.flags,
      length: this.length,
      params: this.params,
      locals: this.locals,
      maxStack: this.maxStack,
      code: new Int32Array(this.words),
      consts: this.constList,
      captures: this.captures,
      handlers: new Int32Array(this.handlerWords),
      finallies: new Int32Array(this.finallyWords),
      finallyOffsets: new Int32Array(this.finallyLevelOffsets),
      sites: new Int32Array(this.sitePairs),
      localNames: this.localNames,
      upvalNames: this.upvalNames,
      sourceObj: this.sourceObj,
    })
  }
}

/** Deterministic FNV-1a 64-bit hash over a compiled `Code[]` array. */
export const hashOf = (codes: ReadonlyArray<Code>): string => {
  let h1 = 0x811c9dc5
  let h2 = 0xcbf29ce4
  const mix = (v: number) => {
    h1 = Math.imul(h1 ^ (v & 0xff), 0x01000193)
    h1 = Math.imul(h1 ^ ((v >>> 8) & 0xff), 0x01000193)
    h2 = Math.imul(h2 ^ ((v >>> 16) & 0xff), 0x01000193)
    h2 = Math.imul(h2 ^ ((v >>> 24) & 0xff), 0xff000193)
  }
  const mixStr = (s: string) => {
    mix(s.length)
    for (let i = 0; i < s.length; i++) mix(s.charCodeAt(i))
  }
  const mixArr = (arr: Int32Array) => {
    mix(arr.length)
    for (let i = 0; i < arr.length; i++) mix(arr[i]!)
  }
  mix(codes.length)
  for (const c of codes) {
    mix(c.index)
    mixStr(c.name)
    mix(c.flags)
    mix(c.length)
    mix(c.params)
    mix(c.locals)
    mix(c.maxStack)
    mixArr(c.code)
    mixArr(c.captures)
    mixArr(c.handlers)
    mixArr(c.finallies)
    mixArr(c.sites)
    mix(c.consts.length)
    for (const k of c.consts) {
      if (typeof k === "string") {
        mix(1)
        mixStr(k)
      } else if (typeof k === "number") {
        mix(2)
        mixStr(Object.is(k, -0) ? "-0" : String(k))
      } else if ("pattern" in k) {
        mix(3)
        mixStr(k.pattern)
        mixStr(k.flags)
      } else if ("cooked" in k) {
        mix(4)
        mix(k.nodeIndex)
        for (const s of k.raw) mixStr(s)
      } else if ("specifier" in k) {
        mix(5)
        mixStr(k.specifier)
        if (k.imported !== undefined) mixStr(k.imported)
      } else {
        mix(6)
        mixStr(k.type)
        mixStr(k.message)
      }
    }
  }
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0")
}
