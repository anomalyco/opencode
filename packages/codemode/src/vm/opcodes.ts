import type { DiagnosticKind } from "../codemode.js"
import type { ErrorType } from "./runtime/intrinsics.js"

/** Uninitialized lexical binding sentinel (temporal dead zone). */
export const HOLE: unique symbol = Symbol("codemode.hole")

/** Mutable box for a binding captured by a closure. */
export class Cell {
  constructor(public v: unknown) {}
}

const initCell = new Cell(0)
initCell.v = 1.5
initCell.v = ""
initCell.v = true
initCell.v = null
initCell.v = undefined
initCell.v = HOLE

const makeEmptyCells = (): ReadonlyArray<Cell> => {
  const arr: Array<unknown> = []
  arr.push(initCell)
  arr.length = 0
  return arr as Array<Cell>
}

export const EMPTY_CELLS: ReadonlyArray<Cell> = makeEmptyCells()

/** Raised when the VM compiler or runtime encounters a feature scheduled for a later phase. */
export class NotYetImplemented extends Error {
  constructor(readonly feature: string) {
    super(`Not yet implemented in VM: ${feature}`)
    this.name = "NotYetImplemented"
  }
}

/**
 * Bytecode opcodes (1 word per instruction: `op:8 | a:8 | bx:16`, widened by `EXTRA` prefixes for `a > 0xff` or `bx > 0xffff`).
 */
export const Op = {
  // Stack and constants (10)
  PUSH_UNDEF: 0,
  PUSH_NULL: 1,
  PUSH_BOOL: 2,
  PUSH_INT: 3,
  PUSH_CONST: 4,
  POP: 5,
  POPN: 6,
  DUP: 7,
  PICK: 8,
  ROT: 9,

  // Variables (15)
  GET_LOCAL: 10,
  PUT_LOCAL: 11,
  HOLE_LOCAL: 12,
  NEW_CELL: 13,
  COPY_CELL: 14,
  GET_CELL: 15,
  PUT_CELL: 16,
  GET_UPVAL: 17,
  PUT_UPVAL: 18,
  GET_GLOBAL: 19,
  GET_INTRINSIC: 20,
  ARGS: 21,
  CLOSURE: 22,
  SET_NAME: 23,
  IMPORT: 24,

  // Properties (10)
  GET_PROP: 25,
  GET_ELEM: 26,
  PUT_PROP: 27,
  PUT_ELEM: 28,
  DELETE_PROP: 29,
  DELETE_ELEM: 30,
  CHECK_BASE: 31,
  TO_KEY: 32,
  IN: 33,
  INSTANCEOF: 34,

  // Literals (8)
  NEW_OBJECT: 35,
  NEW_ARRAY: 36,
  ARRAY_APPEND: 37,
  DEFINE_FIELD: 38,
  COPY_DATA_PROPS: 39,
  COPY_REST: 40,
  TEMPLATE: 41,
  REGEXP: 42,

  // Operators (16)
  ADD: 43,
  SUB: 44,
  MUL: 45,
  LT: 46,
  LE: 47,
  GT: 48,
  GE: 49,
  SEQ: 50,
  SNE: 51,
  BINOP: 52,
  UNARY: 53,
  NOT: 54,
  TO_NUMERIC: 55,
  INC: 56,
  TO_STRING: 57,
  CONCAT: 58,

  // Control (11)
  JUMP: 59,
  LOOP: 60,
  JUMP_IF_FALSE: 61,
  JUMP_IF_TRUE: 62,
  JUMP_COND: 63,
  THROW: 64,
  THROW_ERROR: 65,
  END_FINALLY: 66,
  RETURN: 67,
  NOP: 68,
  EXTRA: 69,

  // Calls (4)
  CALL: 70,
  CALL_SPREAD: 71,
  NEW: 72,
  NEW_SPREAD: 73,

  // Iteration (7)
  ITER_OPEN: 74,
  ITER_INIT: 75,
  ITER_STEP: 76,
  ITER_RESULT: 77,
  ITER_CLOSE: 78,
  ITER_APPEND_ALL: 79,
  FOR_IN: 80,

  // Generators and async (6)
  GENERATOR_START: 81,
  YIELD: 82,
  RESUME: 83,
  AWAIT: 84,
  YSTAR: 85,
  YSTAR_RESULT: 86,

  // Program (1)
  END_PROGRAM: 87,
} as const

export type OpCode = (typeof Op)[keyof typeof Op]

export const OpNames: ReadonlyArray<string> = Object.entries(Op).reduce<Array<string>>((acc, [name, code]) => {
  acc[code] = name
  return acc
}, [])

/** Sub-ops for `Op.BINOP` (`a` operand). */
export const BinOp = {
  DIV: 0,
  MOD: 1,
  EXP: 2,
  BAND: 3,
  BOR: 4,
  BXOR: 5,
  SHL: 6,
  SAR: 7,
  SHR: 8,
  EQ: 9,
  NE: 10,
} as const

export const BinOpSymbols: ReadonlyArray<string> = ["/", "%", "**", "&", "|", "^", "<<", ">>", ">>>", "==", "!="]

/** Sub-ops for `Op.UNARY` (`a` operand). */
export const UnaryOp = {
  NEG: 0,
  PLUS: 1,
  BNOT: 2,
  TYPEOF: 3,
  VOID: 4,
} as const

export const UnaryOpSymbols: ReadonlyArray<string> = ["-", "+", "~", "typeof", "void"]

/** Sub-ops for `Op.JUMP_COND` (`a` operand). */
export const CondKind = {
  /** If top is truthy, keep it and jump; else pop and fall through (`||`, `||=`). */
  TRUTHY_KEEP: 0,
  /** If top is falsy, keep it and jump; else pop and fall through (`&&`, `&&=`). */
  FALSY_KEEP: 1,
  /** If top is not null/undefined, keep it and jump; else pop and fall through (`??`, `??=`). */
  NOT_NULLISH_KEEP: 2,
  /** If top !== undefined, keep it and jump; else pop and fall through (defaults). */
  DEFINED: 3,
  /** If top == null, replace top with undefined and jump; else keep top and fall through (`?.`). */
  NULLISH: 4,
  /** For `[thisValue, callable]`: if callable == null, pop callable, set top to undefined, and jump (`o.m?.()`). */
  NULLISH_METHOD: 5,
} as const

/** Sub-ops for `Op.PUT_LOCAL`, `Op.PUT_CELL`, `Op.PUT_UPVAL` (`a` operand). */
export const PutKind = {
  /** Normal assignment: checks TDZ (`HOLE`). */
  ASSIGN: 0,
  /** Declaration initialization or internal slot write: skips TDZ check. */
  INIT: 1,
  /** Assignment to a `const` or read-only binding: checks TDZ first, then throws `TypeError`. */
  CONST: 2,
} as const

/** Sub-ops for `Op.CHECK_BASE` (`a` operand). */
export const CheckBaseKind = {
  /** `o[k]`: checks `o` is not null/undefined before converting `k` (`[o, k] -> [o, k]`). */
  READ: 0,
  /** `o.x = ...`: checks `o.x` is a writable reference (`[o] -> [o]`, `bx = k`). */
  WRITE_PROP: 1,
  /** `o[k] = ...`: checks `o[k]` is a writable reference after `TO_KEY` (`[o, key] -> [o, key]`). */
  WRITE_ELEM: 2,
  /** Destructuring target check: throws if top is null or undefined (`[v] -> [v]`). */
  DESTRUCTURE: 3,
} as const

/** Sub-ops for `Op.ITER_OPEN` and `Op.ITER_INIT` (`a` operand). */
export const IterContext = {
  FOR_OF: 0,
  DESTRUCTURE: 1,
  SPREAD: 2,
  DELEGATE: 3,
  FOR_AWAIT: 4,
  ASYNC_DELEGATE: 5,
  CHECK_OBJECT: 6,
} as const

/** Sub-ops for `Op.IMPORT` (`a` operand). */
export const ImportKind = {
  DEFAULT: 0,
  NAMESPACE: 1,
  NAMED: 2,
  SIDE_EFFECT: 3,
  DYNAMIC: 4,
} as const

/** Bit flags on `Code.flags`. */
export const CodeFlags = {
  ARROW: 1 << 0,
  ASYNC: 1 << 1,
  GENERATOR: 1 << 2,
  SIMPLE_PARAMS: 1 << 3,
  USES_THIS: 1 << 4,
  USES_ARGUMENTS: 1 << 5,
  INTERNAL: 1 << 6,
  PROGRAM: 1 << 7,
  NEEDS_ARGS: 1 << 9,
} as const

/** Constant pool descriptors. */
export type TemplateSite = {
  readonly cooked: ReadonlyArray<string | undefined>
  readonly raw: ReadonlyArray<string>
  readonly nodeIndex: number
}

export type RegExpSite = {
  readonly pattern: string
  readonly flags: string
}

export type ErrorSite = {
  readonly type: ErrorType
  readonly message: string
  readonly kind?: DiagnosticKind
  readonly suggestions?: ReadonlyArray<string>
}

export type ImportSite = {
  readonly specifier: string
  readonly imported?: string
}

export type ConstValue = string | number | TemplateSite | RegExpSite | ErrorSite | ImportSite

/** Packs one instruction word: `op:8 | a:8 | bx:16`. Throws if any field does not fit its width. */
export const packWord = (op: OpCode, a = 0, bx = 0): number => {
  if ((op & 0xff) !== op || (a & 0xff) !== a || (bx & 0xffff) !== bx) {
    throw new RangeError(`Instruction operand out of single-word range: op=${op} a=${a} bx=${bx}`)
  }
  return op | (a << 8) | (bx << 16)
}
