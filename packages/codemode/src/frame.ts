import type { Code } from "./code.js"
import { type Cell, EMPTY_CELLS } from "./opcodes.js"
import type { AstNode } from "./runtime/model.js"
import type { Fn, Obj, Value } from "./runtime/objects.js"

// The VM's activation records and the small classes its helper modules share, apart from `vm.ts` so `async.ts`,
// `generators.ts`, `host.ts`, `internal-prelude.ts` and `snapshot.ts` can use them without importing the VM.

export const Mode = {
  CALLER: 0,
  ASYNC: 1,
  GENERATOR: 2,
  SETTLE: 3,
  REJECT_ONLY: 4,
  PROGRAM: 5,
  BOUNDARY_OUT: 6,
} as const

export type FrameMode = (typeof Mode)[keyof typeof Mode]

/** Custom synchronous/async iterator state stored in a frame's hidden `%it` slot. */
export class CustomIter {
  done = false
  rawGen = false
  constructor(
    readonly iterator: Obj,
    readonly next: Value,
  ) {}
}

/** Single uniform activation record for the bytecode VM. */
export class Frame {
  fn: Fn | null = null
  cells: ReadonlyArray<Cell> = EMPTY_CELLS
  code: Code
  pc = 0
  sp = 0
  regs: Array<unknown>
  thisValue: Value = undefined
  args: Array<Value> | undefined = undefined
  mode: FrameMode = Mode.CALLER
  target: unknown = undefined
  answer: unknown = undefined
  origin: AstNode | undefined = undefined
  counted = false

  constructor(code: Code, regs: Array<unknown>) {
    this.code = code
    this.regs = regs
  }
}

/** Internal closure wrapper that does not touch `builtins.Function` or `nativeRule.sealed`. */
export class VmInternalFn {
  constructor(
    readonly code: Code,
    readonly boundArgs?: ReadonlyArray<Value>,
  ) {}
}
