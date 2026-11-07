import { parse, type Expression, type MemberExpression, type NewExpression } from "acorn"
import type { Diagnostic } from "../codemode.js"
import { conversions } from "./runtime/callback.js"
import { locate, materialize } from "./runtime/errors.js"
import type { Interpreter } from "./runtime/interpreter.js"
import { checkArrayLength, checkStringLength } from "./runtime/limits.js"
import {
  AsyncIteratorSymbol,
  type AstNode,
  invalidData,
  IteratorSymbol,
  PendingThrow,
  rangeError,
  referenceError,
  syntaxError,
  Throw,
  typeError,
} from "./runtime/model.js"
import {
  Arguments,
  Arr,
  assign,
  BoundFn,
  Builtin,
  type Callable,
  coerceToNumber,
  coerceToString,
  define,
  Fn,
  frozen,
  GeneratorObj,
  get,
  getOwn,
  hasOwn,
  IteratorObj,
  Native,
  type NativeResult,
  Obj,
  Position,
  PromiseObj,
  readonly,
  remove,
  type Value,
} from "./runtime/objects.js"
import {
  applyBinaryOperator,
  assignToReference,
  builtinCursor,
  destructuredProperty,
  forInKeys,
  instanceofValue,
  isThenable,
  notAFunction,
  notConstructible,
  operatorConversion,
  propertyKey,
  readProperty,
  readReference,
  requireIteratorMethod,
  requireIteratorObject,
  requireMemberBase,
  resolveProperty,
  writableReference,
} from "./runtime/operations.js"
import { capability } from "./runtime/promises.js"
import { describeValue, isOpaque, typeofValue } from "./runtime/references.js"
import {
  abrupt,
  type Completion,
  Convert,
  type GeneratorRequest,
  Interruption,
  Invoke,
  MAX_CALL_DEPTH,
  normal,
  Push,
  Resume,
} from "./runtime/signals.js"
import { Source } from "./runtime/source.js"
import type { HostCall, Stop } from "./scheduler.js"
import { compiledPrelude } from "./prelude/prelude.js"
import { constructRegExp } from "./stdlib/regexp.js"
import { enumerableSource } from "./stdlib/object.js"
import { ToolReference } from "../tool-runtime.js"
import { registerAsyncIntrinsics, type SettlingTarget, VmScheduler } from "./async.js"
import type { Code } from "./code.js"
import { type CaptureOptions, captureVm, type RestoreOptions, restoreVm } from "./snapshot.js"
import { compileSource } from "./compiler/compile.js"
import {
  AsyncFromSyncIterator,
  completeGeneratorReturn,
  execAwait,
  execGeneratorStart,
  execResume,
  execYield,
  execYstar,
  execYstarResult,
  handleAdapterPush,
  registerGeneratorIntrinsics,
  resumeVmGenerator,
  unwindGenerator,
} from "./generators.js"
import {
  BLOCK,
  callExtension,
  callSearch,
  callTool,
  ENTERED,
  type HostResult,
  HostCalls,
  registerHostIntrinsics,
  VISIT_BUDGET,
} from "./host.js"
import {
  getInternalPrelude,
  internalCode,
  registerVmIntrinsics,
  tryFastBoundaryOrJson,
  VmIntrinsic,
} from "./internal-prelude.js"
import {
  BinOpSymbols,
  Cell,
  CheckBaseKind,
  CodeFlags,
  CondKind,
  type ConstValue,
  EMPTY_CELLS,
  type ErrorSite,
  HOLE,
  ImportKind,
  type ImportSite,
  IterContext,
  NotYetImplemented,
  Op,
  PutKind,
  type RegExpSite,
  type TemplateSite,
  UnaryOp,
} from "./opcodes.js"
import { hidden } from "./runtime/objects.js"

const contiguous = <T>(): Array<T> => {
  const a: Array<unknown> = [""]
  a.pop()
  return a as Array<T>
}

const INITIAL_FUEL = 10_000
/**
 * What a call to a built-in costs in fuel: one may run far longer than an instruction (describing a rejection, copying
 * a value), so a loop made only of built-in calls still checks the clock every few dozen calls.
 */
const NATIVE_FUEL = 50
const SLICE_MS = 1

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

const EXEC_DONE = 0
const EXEC_FUEL = 1

const allocRegs = (size: number): Array<unknown> => {
  const regs: Array<unknown> = []
  for (let i = 0; i < size; i++) regs.push(HOLE)
  return regs
}

/** Internal closure wrapper that does not touch `builtins.Function` or `nativeRule.sealed`. */
export class VmInternalFn {
  constructor(
    readonly code: Code,
    readonly boundArgs?: ReadonlyArray<Value>,
  ) {}
}

/**
 * Runs a runtime's program code: the job stack, the job queue, promises, and host calls. `execute.ts` and the driver
 * use only its host surface:
 *
 * - **Starting.** Exactly one of `start(source)` (a new run) or `restore(saved, …)` (a saved one), once. Host call
 *   ids count up in program order.
 * - **Running.** `run()` is synchronous, runs no host work, and returns a `Stop`:
 *   - `host(calls)`: start these queued calls now (they are `queued`; the driver marks them `running`),
 *     then call `run()` again; `host([])` means wait until `ready` (a blocking call or the inbox has input) and call
 *     `run()` again;
 *   - `slice`: the time slice is over; yield to the host scheduler and call `run()` again;
 *   - `done(completion)`: the program's body ended; host calls may still be running (`diagnostics()` reports
 *     unhandled rejections);
 *   - `stuck(node)`: nothing is queued or running, and the body awaits something that can never settle.
 * - **Host calls.** `complete(id, completion)` reports how a handed-over call ended, at any time between `run()`s: a
 *   blocking call's outcome continues the job that made it; a concurrent call's waits in the inbox and settles its
 *   promise in a later job, in completion order. Unknown or completed ids are ignored. `call(id)`/`calls()` list the
 *   calls handed over and not completed, in the order they were made.
 * - **Snapshots.** `capture` and `restore` run only between `run()`s, synchronously. A capture changes nothing a
 *   later `run()` sees; it fails (throws) only on a codec gap. A state holding live host values (`calls()` with an
 *   extension call, or `activeExtension`) can't be restored faithfully.
 */
export class Vm {
  readonly frames: Array<Frame> = contiguous<Frame>()
  private readonly pool: Array<Frame> = contiguous<Frame>()
  readonly sourceCodes = new Map<string, ReadonlyArray<Code>>()
  readonly templates = new Map<string, Arr>()
  readonly intrinsics = new Map<string, unknown>()
  readonly scheduler: VmScheduler
  /** Host calls: queued, running, completed, and the blocking one the job on the stack waits on. */
  readonly hosts: HostCalls

  depth = 0
  fuel = INITIAL_FUEL
  /** When the current slice began; -1 until the next `run` starts one. Host stops don't end a slice, only a yield does. */
  sliceStart = -1
  sliced = false
  outcome: Completion | undefined = undefined
  /** Round-trip test mode (task C): slice after this many fuel ticks, so the run is saved and restored all through. */
  tripEvery = 0

  constructor(readonly ctx: Interpreter<unknown>) {
    this.scheduler = new VmScheduler(this)
    this.scheduler.intrinsicThen = get(ctx.builtins.Promise, "then") as Callable
    this.hosts = new HostCalls(ctx, this.scheduler)
    const internal = getInternalPrelude()
    const prelude = compiledPrelude()
    this.sourceCodes.set("@vm-internal", internal.codes)
    this.sourceCodes.set("@prelude", prelude.codes)
    for (const val of ctx.prelude.scope.values()) {
      if (val instanceof Fn && val.cells.length === 0 && val.cells !== EMPTY_CELLS) {
        ;(val as { cells: ReadonlyArray<Cell> }).cells = EMPTY_CELLS
      }
    }
  }

  private initIntrinsics(): void {
    registerVmIntrinsics(this.intrinsics, this)
    registerAsyncIntrinsics(this.intrinsics, this)
    registerGeneratorIntrinsics(this.intrinsics, this)
    registerHostIntrinsics(this.intrinsics, this)
  }

  private getIntrinsic(name: string): unknown {
    const p = this.ctx.prelude.scope.get(name)
    if (p !== undefined) return p
    if (this.intrinsics.size === 0) this.initIntrinsics()
    return this.intrinsics.get(name)
  }

  /** Queues the program's body as the root frame. */
  start(source: Source): void {
    if (!warmed) warmupVm(this)
    this.ctx.sources.set(source.id, source)
    let codes: ReadonlyArray<Code>
    try {
      codes = compileSource(source)
    } catch (error) {
      // A program nested deeper than the compiler's host stack fails the run, as running it would.
      if (!(error instanceof RangeError)) throw error
      this.outcome = abrupt(error)
      return
    }
    this.sourceCodes.set(source.id, codes)
    const progCode = codes[0]!
    const frame = this.acquire(progCode)
    frame.fn = null
    frame.cells = EMPTY_CELLS
    frame.pc = 0
    frame.sp = progCode.locals
    frame.thisValue = undefined
    frame.args = undefined
    frame.mode = Mode.PROGRAM
    frame.origin = undefined
    frame.counted = true
    this.depth = 1
    this.frames.push(frame)
  }

  /**
   * Runs until it has to stop (`Stop`), in this order: hand over queued host calls; a due slice; continue the job a
   * completed blocking call waits on; wait while the job on the stack is blocked; continue a sliced job before any
   * other; the outcome; the next job; one inbox completion; wait for running calls; stuck.
   */
  run(): Stop {
    if (this.sliceStart < 0) this.sliceStart = performance.now()
    if (this.tripEvery > 0) this.fuel = this.tripEvery
    const sched = this.scheduler
    const hosts = this.hosts
    while (true) {
      if (hosts.queued.length > 0) return { kind: "host", calls: hosts.handOver() }
      if (this.sliced) {
        this.sliced = false
        this.sliceStart = -1
        return { kind: "slice" }
      }
      const input = hosts.input
      if (input !== undefined) {
        hosts.input = undefined
        this.resumeBlocked(input)
        continue
      }
      if (this.frames.length > 0) {
        if (hosts.blocked !== undefined) return { kind: "host", calls: [] }
        // Fuel can run out on a call that then stopped for the host (a built-in or sync extension call costs fuel too):
        // that's a slice point as well, or a loop of such calls would refill forever without yielding.
        if (this.fuel <= 0) {
          this.fuel = this.tripEvery || INITIAL_FUEL
          if (this.tripEvery > 0 || performance.now() - this.sliceStart >= SLICE_MS) {
            this.sliced = true
            continue
          }
        }
        let signal = EXEC_DONE
        try {
          signal = this.exec()
        } catch (error) {
          if (error instanceof NotYetImplemented) throw error
          this.unwind(error)
          continue
        }
        if (signal === EXEC_FUEL) {
          this.fuel = this.tripEvery || INITIAL_FUEL
          if (this.tripEvery > 0 || performance.now() - this.sliceStart >= SLICE_MS) {
            this.sliced = true
          }
        }
        continue
      }
      if (this.outcome !== undefined) return { kind: "done", completion: this.outcome }
      const job = sched.dequeue()
      if (job !== undefined) {
        sched.beginJob(job)
        if (--this.fuel <= 0) {
          this.fuel = this.tripEvery || INITIAL_FUEL
          if (this.tripEvery > 0 || performance.now() - this.sliceStart >= SLICE_MS) {
            this.sliced = true
          }
        }
        continue
      }
      if (hosts.deliver()) continue
      if (hosts.running.size > 0) return { kind: "host", calls: [] }
      return { kind: "stuck", node: sched.stuckAwait() }
    }
  }

  // Continues the job stopped at a blocking call with the call's result, or throws its failure at the call.
  private resumeBlocked(input: { readonly call: HostCall; readonly completion: Completion }): void {
    const frame = this.frames[this.frames.length - 1]!
    try {
      const result = this.hosts.resume(input)
      if (result === BLOCK || result === ENTERED) return
      frame.regs[frame.sp++] = result
      frame.pc++
    } catch (error) {
      this.unwind(error)
    }
  }

  /** Reports how host work handed over by a `host` stop ended. */
  complete(id: number, completion: Completion): void {
    this.hosts.complete(id, completion)
  }

  /** Whether `run` has something to do: a blocking call's outcome, or one in the inbox while no job runs. */
  get ready(): boolean {
    const hosts = this.hosts
    return hosts.input !== undefined || (this.frames.length === 0 && (hosts.inbox.length > 0 || this.scheduler.hasJobs))
  }

  /** A host call handed over and not yet completed, by id. */
  call(id: number): HostCall | undefined {
    return this.hosts.running.get(id)
  }

  /** The host calls handed over and not yet completed, in the order they were made. */
  calls(): Array<HostCall> {
    return [...this.hosts.running.values()]
  }

  compact(): void {
    this.scheduler.compact()
  }

  /** Unhandled rejections, in promise creation order, once inbox completions are delivered. */
  diagnostics(): Array<Diagnostic> {
    while (this.hosts.deliver());
    return this.scheduler.diagnostics()
  }

  /**
   * A synchronous extension call the program is in the middle of, from its `before` hook until its result is a
   * program value or its concurrent call is running: it holds live host values.
   */
  get activeExtension(): { readonly key: string; readonly path: string } | undefined {
    return this.hosts.extension
  }

  /** Saves the run's state as it is now. */
  capture(options: CaptureOptions) {
    if (this.intrinsics.size === 0) this.initIntrinsics()
    return captureVm(this, options)
  }

  /** Restores a saved state into this fresh VM, after checking it belongs to this build and runtime. */
  restore(saved: unknown, options: RestoreOptions) {
    if (this.intrinsics.size === 0) this.initIntrinsics()
    return restoreVm(this, saved, options)
  }

  deliverAnswer(frame: Frame): void {
    if (frame.answer !== undefined) {
      const answer = frame.answer as Value
      frame.answer = undefined
      const caller = this.frames[this.frames.length - 1]
      if (caller !== undefined) {
        caller.regs[caller.sp++] = answer
        caller.pc++
      }
    }
  }

  acquire(code: Code): Frame {
    const size = code.locals + code.maxStack
    const pool = this.pool
    if (pool.length === 0) {
      return new Frame(code, allocRegs(size))
    }
    const f = pool.pop()!
    f.code = code
    const regs = f.regs
    if (regs.length < size) {
      f.regs = allocRegs(size)
    } else {
      for (let i = 0, n = code.locals; i < n; i++) regs[i] = HOLE
    }
    return f
  }

  release(frame: Frame): void {
    if (frame.counted) this.depth--
    frame.fn = null
    frame.cells = EMPTY_CELLS
    frame.thisValue = undefined
    frame.args = undefined
    frame.target = undefined
    frame.answer = undefined
    frame.origin = undefined
    frame.counted = false
    if (this.pool.length < 128) this.pool.push(frame)
  }

  private codesOf(code: Code): ReadonlyArray<Code> {
    return this.sourceCodes.get(code.source.id)!
  }

  /**
   * Nearest non-internal frame's AST site, or the bottom internal frame's `origin` (§3.6). A failure the host
   * boundary's own walk raises (copying out the result, or a tool call's arguments) has no location: the call that
   * crosses reports it.
   */
  currentSite(): AstNode | undefined {
    for (let i = this.frames.length - 1; i >= 0; i--) {
      const f = this.frames[i]!
      if ((f.code.flags & CodeFlags.INTERNAL) === 0) {
        return f.code.siteAt(f.pc)
      }
      if (f.mode === Mode.BOUNDARY_OUT || f.mode === Mode.REJECT_ONLY) return undefined
      if (f.origin !== undefined) return f.origin
    }
    return undefined
  }

  private exec(): number {
    const frames = this.frames
    const hole = HOLE
    const CellCtor = Cell
    const ArrCtor = Arr
    const ObjCtor = Obj
    const FnCtor = Fn
    const PositionCtor = Position
    const globalScope = this.ctx.globalScope
    const objectProto = this.ctx.builtins.Object
    let frame!: Frame
    let fcode!: Code
    let code!: Int32Array
    let regs!: Array<unknown>
    let consts!: ReadonlyArray<ConstValue>
    let cells!: ReadonlyArray<Cell>
    let pc = 0
    let sp = 0
    outer: for (;;) {
      if (frames.length === 0) return 0
      frame = frames[frames.length - 1]!
      fcode = frame.code
      code = fcode.code
      regs = frame.regs
      consts = fcode.consts
      pc = frame.pc | 0
      cells = frame.cells
      sp = frame.sp | 0
      for (;;) {
        const w = code[pc]!
        switch (w & 0xff) {
          case 0: // Op.PUSH_UNDEF
            regs[sp++] = undefined
            pc++
            continue
          case 1: // Op.PUSH_NULL
            regs[sp++] = null
            pc++
            continue
          case 2: // Op.PUSH_BOOL
            regs[sp++] = (w & 0xff00) === 0x0100
            pc++
            continue
          case 3: // Op.PUSH_INT
            regs[sp++] = w >> 16
            pc++
            continue
          case 4: // Op.PUSH_CONST
            regs[sp++] = consts[w >>> 16]
            pc++
            continue
          case 5: // Op.POP
            sp--
            pc++
            continue
          case 6: // Op.POPN
            sp -= w >>> 16
            pc++
            continue
          case 7: // Op.DUP
            regs[sp] = regs[sp - 1]
            sp++
            pc++
            continue
          case 8: // Op.PICK
            regs[sp] = regs[sp - 1 - ((w >>> 8) & 0xff)]
            sp++
            pc++
            continue
          case 9: // Op.ROT
            this.execRot(regs, (w >>> 8) & 0xff, sp)
            pc++
            continue
          case 10: {
            // Op.GET_LOCAL
            const slot = w >>> 16
            const v = regs[slot]
            if (v === hole) this.failTdz(frame, fcode.localNames[slot]!, pc, sp)
            regs[sp++] = v
            pc++
            continue
          }
          case 11: {
            // Op.PUT_LOCAL
            const slot = w >>> 16
            const kind = (w >>> 8) & 0xff
            const v = regs[--sp]
            if (kind !== 1 && (regs[slot] === hole || kind === 2)) {
              this.failPut(frame, fcode.localNames[slot]!, regs[slot], pc, sp)
            }
            regs[slot] = v
            pc++
            continue
          }
          case 12: // Op.HOLE_LOCAL
            regs[w >>> 16] = hole
            pc++
            continue
          case 13: {
            // Op.NEW_CELL
            const slot = w >>> 16
            regs[slot] = new CellCtor((w & 0xff00) === 0x0100 ? regs[slot] : hole)
            pc++
            continue
          }
          case 14: {
            // Op.COPY_CELL
            const slot = w >>> 16
            regs[slot] = new CellCtor((regs[slot] as Cell).v)
            pc++
            continue
          }
          case 15: {
            // Op.GET_CELL
            const slot = w >>> 16
            const v = (regs[slot] as Cell).v
            if (v === hole) this.failTdz(frame, fcode.localNames[slot]!, pc, sp)
            regs[sp++] = v
            pc++
            continue
          }
          case 16: {
            // Op.PUT_CELL
            const slot = w >>> 16
            const kind = (w >>> 8) & 0xff
            const v = regs[--sp]
            const cell = regs[slot] as Cell
            if (kind !== 1 && (cell.v === hole || kind === 2)) {
              this.failPut(frame, fcode.localNames[slot]!, cell.v, pc, sp)
            }
            cell.v = v
            pc++
            continue
          }
          case 17: {
            // Op.GET_UPVAL
            const idx = w >>> 16
            const v = cells[idx]!.v
            if (v === hole) this.failTdz(frame, fcode.upvalNames[idx]!, pc, sp)
            regs[sp++] = v
            pc++
            continue
          }
          case 18: {
            // Op.PUT_UPVAL
            const idx = w >>> 16
            const kind = (w >>> 8) & 0xff
            const v = regs[--sp]
            const cell = cells[idx]!
            if (kind !== 1 && (cell.v === hole || kind === 2)) {
              this.failPut(frame, fcode.upvalNames[idx]!, cell.v, pc, sp)
            }
            cell.v = v
            pc++
            continue
          }
          case 19: {
            // Op.GET_GLOBAL
            const name = consts[w >>> 16] as string
            if ((w & 0xff00) === 0) {
              const binding = globalScope.get(name)
              if (binding !== undefined) {
                regs[sp++] = binding.value
                pc++
                continue
              }
            }
            regs[sp++] = this.execGetGlobal(frame, (w >>> 8) & 0xff, name, pc, sp)
            pc++
            continue
          }
          case 20: // Op.GET_INTRINSIC
            regs[sp++] = this.getIntrinsic(consts[w >>> 16] as string)
            pc++
            continue
          case 21: // Op.ARGS
            regs[sp++] = this.execArgs(frame, (w >>> 8) & 0xff, w >>> 16)
            pc++
            continue
          case 22: // Op.CLOSURE
            regs[sp++] = this.makeClosure(fcode, w >>> 16, regs, cells)
            pc++
            continue
          case 23: // Op.SET_NAME
            this.execSetName(regs, consts, (w >>> 8) & 0xff, w >>> 16, sp)
            pc++
            continue
          case 24: // Op.IMPORT
            frame.pc = pc
            frame.sp = sp
            sp = this.execImport(frame, (w >>> 8) & 0xff, w >>> 16, pc, sp)
            pc++
            continue
          case 25: {
            // Op.GET_PROP
            const o = regs[sp - 1] as Value
            const key = consts[w >>> 16] as string
            const mode = (w >>> 8) & 0xff
            if (key === "length" && mode === 0) {
              if (typeof o === "string") {
                regs[sp - 1] = o.length
                pc++
                continue
              }
              if (o instanceof ArrCtor) {
                regs[sp - 1] = o.items.length
                pc++
                continue
              }
            }
            frame.pc = pc
            frame.sp = sp
            sp = this.execGetProp(frame, o, key, mode, pc, sp)
            pc++
            continue
          }
          case 26: {
            // Op.GET_ELEM
            const keyVal = regs[sp - 1] as Value
            const o = regs[sp - 2] as Value
            const mode = (w >>> 8) & 0xff
            if (
              mode === 0 &&
              typeof keyVal === "number" &&
              keyVal >= 0 &&
              (keyVal | 0) === keyVal &&
              o instanceof ArrCtor &&
              keyVal in o.items
            ) {
              sp--
              regs[sp - 1] = o.items[keyVal]
              pc++
              continue
            }
            frame.pc = pc
            frame.sp = sp
            if (this.execGetElem(frame, o, keyVal, mode, pc, sp)) continue outer
            sp = frame.sp
            pc++
            continue
          }
          case 27: {
            // Op.PUT_PROP
            const v = regs[--sp] as Value
            const o = regs[sp - 1] as Value
            frame.pc = pc
            frame.sp = sp
            this.execPutProp(fcode, o, consts[w >>> 16] as string, v, pc)
            regs[sp - 1] = v
            pc++
            continue
          }
          case 28: {
            // Op.PUT_ELEM
            const v = regs[--sp] as Value
            const keyVal = regs[--sp] as Value
            const o = regs[sp - 1] as Value
            if (
              typeof keyVal === "number" &&
              keyVal >= 0 &&
              (keyVal | 0) === keyVal &&
              (typeof v !== "object" || v === null) &&
              o instanceof ArrCtor &&
              o.elements.writable &&
              o.extensible
            ) {
              const items = o.items
              if (keyVal < items.length) {
                if (keyVal === 0) items[0] = ""
                items[keyVal] = v
                regs[sp - 1] = v
                pc++
                continue
              }
              if (keyVal === items.length && keyVal < 10_000_000) {
                items.push(v)
                regs[sp - 1] = v
                pc++
                continue
              }
            }
            frame.pc = pc
            frame.sp = sp
            this.execPutElem(fcode, o, keyVal, v, pc)
            regs[sp - 1] = v
            pc++
            continue
          }
          case 29: // Op.DELETE_PROP
            frame.pc = pc
            frame.sp = sp
            regs[sp - 1] = this.execDeleteProp(fcode, regs[sp - 1] as Value, consts[w >>> 16] as string, pc)
            pc++
            continue
          case 30: {
            // Op.DELETE_ELEM
            const keyVal = regs[--sp] as Value
            const o = regs[sp - 1] as Value
            frame.pc = pc
            frame.sp = sp
            if (this.execDeleteElem(frame, o, keyVal, pc, sp)) continue outer
            sp = frame.sp
            pc++
            continue
          }
          case 31: // Op.CHECK_BASE
            frame.pc = pc
            frame.sp = sp
            this.execCheckBase(fcode, (w >>> 8) & 0xff, w >>> 16, regs, sp, pc)
            pc++
            continue
          case 32: {
            // Op.TO_KEY
            const v = regs[sp - 1] as Value
            if (typeof v === "string" || typeof v === "number" || typeof v === "symbol") {
              pc++
              continue
            }
            if (this.execToKey(frame, v, pc, sp)) continue outer
            pc++
            continue
          }
          case 33: {
            // Op.IN
            const rhs = regs[--sp] as Value
            const lhs = regs[sp - 1] as Value
            if (typeof lhs === "number" && lhs >= 0 && (lhs | 0) === lhs && rhs instanceof ArrCtor) {
              regs[sp - 1] = lhs in rhs.items
              pc++
              continue
            }
            if (this.execIn(frame, lhs, rhs, pc, sp)) continue outer
            pc++
            continue
          }
          case 34: {
            // Op.INSTANCEOF
            const rhs = regs[--sp] as Value
            frame.pc = pc
            frame.sp = sp
            regs[sp - 1] = this.execInstanceof(fcode, regs[sp - 1] as Value, rhs, pc)
            pc++
            continue
          }
          case 35: // Op.NEW_OBJECT
            regs[sp++] = new ObjCtor(objectProto)
            pc++
            continue
          case 36: // Op.NEW_ARRAY
            sp = this.execNewArray(regs, w >>> 16, sp)
            pc++
            continue
          case 37: // Op.ARRAY_APPEND
            frame.pc = pc
            frame.sp = sp
            sp = this.execArrayAppend(regs, (w >>> 8) & 0xff, sp)
            pc++
            continue
          case 38: // Op.DEFINE_FIELD
            sp = this.execDefineField(regs, consts, (w >>> 8) & 0xff, w >>> 16, sp)
            pc++
            continue
          case 39: // Op.COPY_DATA_PROPS
            frame.pc = pc
            frame.sp = --sp
            this.execCopyDataProps(fcode, regs[sp - 1] as Obj, regs[sp] as Value, pc)
            pc++
            continue
          case 40: // Op.COPY_REST
            frame.pc = pc
            frame.sp = sp
            sp = this.execCopyRest(fcode, regs, w >>> 16, pc, sp)
            pc++
            continue
          case 41: // Op.TEMPLATE
            regs[sp++] = this.getTemplateObject(fcode, consts[w >>> 16] as TemplateSite)
            pc++
            continue
          case 42: // Op.REGEXP
            frame.pc = pc
            frame.sp = sp
            regs[sp++] = this.execRegExp(fcode, consts[w >>> 16] as RegExpSite, pc)
            pc++
            continue
          case 43: {
            // Op.ADD
            const b = regs[--sp] as Value
            const a = regs[sp - 1] as Value
            if (typeof a === "number" && typeof b === "number") {
              regs[sp - 1] = a + b
              pc++
              continue
            }
            if (
              (typeof a === "string" || typeof b === "string") &&
              (a === null || (typeof a !== "object" && typeof a !== "symbol")) &&
              (b === null || (typeof b !== "object" && typeof b !== "symbol"))
            ) {
              const s = (a as string) + (b as string)
              if (s.length > 16_777_216) {
                frame.pc = pc
                frame.sp = sp
                this.failStringLength(s.length)
              }
              regs[sp - 1] = s
              pc++
              continue
            }
            frame.pc = pc
            frame.sp = sp
            if (this.execBinarySlow(frame, "+", a, b, pc, sp)) continue outer
            pc++
            continue
          }
          case 44: {
            // Op.SUB
            const b = regs[--sp] as Value
            const a = regs[sp - 1] as Value
            if (typeof a === "number" && typeof b === "number") {
              regs[sp - 1] = a - b
              pc++
              continue
            }
            frame.pc = pc
            frame.sp = sp
            if (this.execBinarySlow(frame, "-", a, b, pc, sp)) continue outer
            pc++
            continue
          }
          case 45: {
            // Op.MUL
            const b = regs[--sp] as Value
            const a = regs[sp - 1] as Value
            if (typeof a === "number" && typeof b === "number") {
              regs[sp - 1] = a * b
              pc++
              continue
            }
            frame.pc = pc
            frame.sp = sp
            if (this.execBinarySlow(frame, "*", a, b, pc, sp)) continue outer
            pc++
            continue
          }
          case 46: {
            // Op.LT
            const b = regs[--sp] as Value
            const a = regs[sp - 1] as Value
            if (typeof a === "number" && typeof b === "number") {
              regs[sp - 1] = a < b
              pc++
              continue
            }
            frame.pc = pc
            frame.sp = sp
            if (this.execBinarySlow(frame, "<", a, b, pc, sp)) continue outer
            pc++
            continue
          }
          case 47: {
            // Op.LE
            const b = regs[--sp] as Value
            const a = regs[sp - 1] as Value
            if (typeof a === "number" && typeof b === "number") {
              regs[sp - 1] = a <= b
              pc++
              continue
            }
            frame.pc = pc
            frame.sp = sp
            if (this.execBinarySlow(frame, "<=", a, b, pc, sp)) continue outer
            pc++
            continue
          }
          case 48: {
            // Op.GT
            const b = regs[--sp] as Value
            const a = regs[sp - 1] as Value
            if (typeof a === "number" && typeof b === "number") {
              regs[sp - 1] = a > b
              pc++
              continue
            }
            frame.pc = pc
            frame.sp = sp
            if (this.execBinarySlow(frame, ">", a, b, pc, sp)) continue outer
            pc++
            continue
          }
          case 49: {
            // Op.GE
            const b = regs[--sp] as Value
            const a = regs[sp - 1] as Value
            if (typeof a === "number" && typeof b === "number") {
              regs[sp - 1] = a >= b
              pc++
              continue
            }
            frame.pc = pc
            frame.sp = sp
            if (this.execBinarySlow(frame, ">=", a, b, pc, sp)) continue outer
            pc++
            continue
          }
          case 50: {
            // Op.SEQ
            const b = regs[--sp]
            regs[sp - 1] = regs[sp - 1] === b
            pc++
            continue
          }
          case 51: {
            // Op.SNE
            const b = regs[--sp]
            regs[sp - 1] = regs[sp - 1] !== b
            pc++
            continue
          }
          case 52: {
            // Op.BINOP
            const b = regs[--sp] as Value
            const a = regs[sp - 1] as Value
            const sub = (w >>> 8) & 0xff
            if (typeof a === "number" && typeof b === "number") {
              regs[sp - 1] = sub === 1 ? a % b : this.execBinopNum(sub, a, b)
              pc++
              continue
            }
            frame.pc = pc
            frame.sp = sp
            if (this.execBinopSlow(frame, sub, a, b, pc, sp)) continue outer
            pc++
            continue
          }
          case 53: {
            // Op.UNARY
            const sub = (w >>> 8) & 0xff
            const v = regs[sp - 1] as Value
            if (typeof v === "number" && sub < 3) {
              regs[sp - 1] = sub === 0 ? -v : sub === 1 ? +v : ~v
              pc++
              continue
            }
            frame.pc = pc
            frame.sp = sp
            if (this.execUnarySlow(frame, sub, v, pc, sp)) continue outer
            pc++
            continue
          }
          case 54: // Op.NOT
            regs[sp - 1] = !regs[sp - 1]
            pc++
            continue
          case 55: {
            // Op.TO_NUMERIC
            const v = regs[sp - 1] as Value
            if (typeof v === "number") {
              pc++
              continue
            }
            if (this.execToNumericSlow(frame, (w >>> 8) & 0xff, v, pc, sp)) continue outer
            pc++
            continue
          }
          case 56: {
            // Op.INC
            const v = regs[sp - 1] as Value
            if (typeof v === "number") {
              regs[sp - 1] = (w & 0xff00) === 0 ? v + 1 : v - 1
              pc++
              continue
            }
            if (this.execIncSlow(frame, (w >>> 8) & 0xff, v, pc, sp)) continue outer
            pc++
            continue
          }
          case 57: {
            // Op.TO_STRING
            const v = regs[sp - 1] as Value
            if (typeof v === "string") {
              pc++
              continue
            }
            if (typeof v === "number") {
              regs[sp - 1] = "" + v
              pc++
              continue
            }
            if (this.execToStringSlow(frame, (w >>> 8) & 0xff, v, pc, sp)) continue outer
            pc++
            continue
          }
          case 58: {
            // Op.CONCAT
            const n = w >>> 16
            if (n === 2) {
              const b = regs[--sp] as string
              const s = (regs[sp - 1] as string) + b
              if (s.length > 16_777_216) {
                frame.pc = pc
                frame.sp = sp
                this.failStringLength(s.length)
              }
              regs[sp - 1] = s
              pc++
              continue
            }
            frame.pc = pc
            frame.sp = sp
            sp = this.execConcat(regs, n, sp)
            pc++
            continue
          }
          case 59: // Op.JUMP
            pc = w >>> 16
            continue
          case 60: // Op.LOOP
            pc = w >>> 16
            if (--this.fuel <= 0) {
              frame.pc = pc
              frame.sp = sp
              return 1
            }
            continue
          case 61: // Op.JUMP_IF_FALSE
            if (regs[--sp]) pc++
            else pc = w >>> 16
            continue
          case 62: // Op.JUMP_IF_TRUE
            if (regs[--sp]) pc = w >>> 16
            else pc++
            continue
          case 63: {
            // Op.JUMP_COND
            const v = regs[sp - 1]
            const sub = (w >>> 8) & 0xff
            if (sub >= 4) {
              if (v === null || v === undefined) {
                if (sub === 5) sp--
                regs[sp - 1] = undefined
                pc = w >>> 16
              } else {
                pc++
              }
              continue
            }
            const jump = sub === 0 ? !!v : sub === 1 ? !v : sub === 2 ? v !== null && v !== undefined : v !== undefined
            if (jump) {
              pc = w >>> 16
            } else {
              sp--
              pc++
            }
            continue
          }
          case 64: // Op.THROW
            this.execThrow(frame, regs[--sp] as Value, pc, sp)
          case 65: // Op.THROW_ERROR
            this.execThrowError(frame, w >>> 16, pc, sp)
          case 66: // Op.END_FINALLY
            pc = this.execEndFinally(frame, w >>> 16, pc, sp)
            continue
          case 67: // Op.RETURN
          case 87: {
            // Op.END_PROGRAM
            const v = regs[sp - 1] as Value
            if (frame.mode === 0) {
              frames.pop()
              if (frame.counted) this.depth--
              if (this.pool.length < 128) this.pool.push(frame)
              const caller = frames[frames.length - 1]!
              caller.regs[caller.sp++] = v
              caller.pc++
              continue outer
            }
            if (this.execReturnSlow(frame, v, pc, sp)) continue outer
            return 0
          }
          case 68: // Op.NOP
            pc++
            continue
          case 69: {
            // Op.EXTRA
            const nextPc = this.execExtra(frame, w, pc, sp)
            if (nextPc < 0) {
              if (nextPc === -1) continue outer
              return -2 - nextPc
            }
            sp = frame.sp
            pc = nextPc
            continue
          }
          case 70: {
            // Op.CALL
            const n = (w >>> 8) & 0xff
            const base = sp - n
            const callee = regs[base - 1]
            if (callee instanceof FnCtor) {
              const c = callee.code
              if ((c.flags & 518) === 0) {
                const counted = (c.flags & 64) === 0
                if (counted && this.depth > 10_000) {
                  this.failCallDepth(frame, fcode, pc, sp)
                }
                if (counted) this.depth++
                const f = this.acquire(c)
                f.fn = callee
                f.cells = callee.cells
                f.counted = counted
                const r = f.regs
                const p = c.params
                if (p === 1) {
                  r[0] = n > 0 ? regs[base] : undefined
                } else if (p === 2) {
                  r[0] = n > 0 ? regs[base] : undefined
                  r[1] = n > 1 ? regs[base + 1] : undefined
                } else if (p > 2) {
                  this.copyParams(r, regs, base, n, p)
                }
                f.thisValue = regs[base - 2] as Value
                f.origin = counted ? undefined : (fcode.flags & 64) === 0 ? fcode.siteAt(pc) : frame.origin
                frame.pc = pc
                frame.sp = base - 2
                f.pc = 0
                f.sp = c.locals
                f.mode = 0
                frames.push(f)
                if (--this.fuel <= 0) return 1
                continue outer
              }
            }
            frame.pc = pc
            frame.sp = sp
            const called = this.execCallSlow(frame, n, pc, sp)
            if (called === 1) {
              if (this.fuel <= 0) return 1
              continue outer
            }
            if (called === 2) return 2
            sp = frame.sp
            pc++
            frame.pc = pc
            if (this.fuel <= 0) return 1
            continue
          }
          case 71: {
            // Op.CALL_SPREAD
            const called = this.execCallSpread(frame, pc, sp)
            if (called === 1) {
              if (this.fuel <= 0) return 1
              continue outer
            }
            if (called === 2) return 2
            sp = frame.sp
            pc++
            frame.pc = pc
            if (this.fuel <= 0) return 1
            continue
          }
          case 72: // Op.NEW
            if (this.execNew(frame, (w >>> 8) & 0xff, pc, sp)) continue outer
            sp = frame.sp
            pc++
            continue
          case 73: // Op.NEW_SPREAD
            if (this.execNewSpread(frame, pc, sp)) continue outer
            sp = frame.sp
            pc++
            continue
          case 74: // Op.ITER_OPEN
            frame.pc = pc
            frame.sp = sp
            pc = this.execIterOpen(frame, (w >>> 8) & 0xff, pc, sp)
            sp = frame.sp
            continue
          case 75: // Op.ITER_INIT
            frame.pc = pc
            frame.sp = sp
            this.execIterInit(frame, (w >>> 8) & 0xff, pc, sp)
            pc++
            continue
          case 76: {
            // Op.ITER_STEP
            const rec = regs[(w >>> 8) & 0xff]
            if (rec instanceof PositionCtor) {
              const step = rec.step()
              if (!step.done) {
                regs[sp++] = step.value
                pc += 2
              } else {
                pc = w >>> 16
              }
              continue
            }
            if (this.execIterStepSlow(frame, rec as CustomIter, w >>> 16, pc, sp)) continue outer
            sp = frame.sp
            pc = frame.pc
            continue
          }
          case 77: // Op.ITER_RESULT
            pc = this.execIterResult(frame, (w >>> 8) & 0xff, w >>> 16, pc, sp)
            sp = frame.sp
            continue
          case 78: // Op.ITER_CLOSE
            pc = this.execIterClose(frame, (w >>> 8) & 0xff, w >>> 16, pc, sp)
            sp = frame.sp
            continue
          case 79: // Op.ITER_APPEND_ALL
            pc = this.execIterAppendAll(frame, (w >>> 8) & 0xff, w >>> 16, pc, sp)
            continue
          case 80: // Op.FOR_IN
            frame.pc = pc
            frame.sp = sp
            regs[sp - 1] = this.execForIn(fcode, regs[sp - 1] as Value, pc)
            pc++
            continue
          case 81: // Op.GENERATOR_START
            this.onGeneratorStart(frame, pc, sp)
            continue outer
          case 82: // Op.YIELD
            if (this.onYield(frame, pc, sp)) continue outer
            sp = frame.sp
            pc = frame.pc
            continue
          case 83: // Op.RESUME
            if (regs[sp - 1] === 0) {
              sp--
              pc = w >>> 16
              continue
            }
            pc = this.onResume(frame, w >>> 16, pc, sp)
            sp = frame.sp
            continue
          case 84: // Op.AWAIT
            this.onAwait(frame, (w >>> 8) & 0xff, pc, sp)
            continue outer
          case 85: // Op.YSTAR
            frame.pc = pc
            frame.sp = sp
            pc = this.onYstar(frame, (w >>> 8) & 0xff, w >>> 16, pc, sp)
            sp = frame.sp
            continue
          case 86: // Op.YSTAR_RESULT
            frame.pc = pc
            frame.sp = sp
            pc = this.onYstarResult(frame, (w >>> 8) & 0xff, w >>> 16, pc, sp)
            sp = frame.sp
            continue
          default:
            this.failOpcode(w & 0xff)
        }
      }
    }
  }

  private copyParams(r: Array<unknown>, regs: Array<unknown>, base: number, n: number, p: number): void {
    for (let i = 0; i < p; i++) r[i] = i < n ? regs[base + i] : undefined
  }

  private failCallDepth(frame: Frame, fcode: Code, pc: number, sp: number): never {
    frame.pc = pc
    frame.sp = sp
    throw rangeError("Maximum call stack size exceeded", fcode.siteAt(pc))
  }

  private failStringLength(len: number): void {
    checkStringLength(len)
  }

  private execInstanceof(fcode: Code, lhs: Value, rhs: Value, pc: number): boolean {
    return instanceofValue(lhs, rhs, fcode.siteAt(pc)!)
  }

  private execBinopSlow(frame: Frame, sub: number, a: Value, b: Value, pc: number, sp: number): boolean {
    return this.execBinarySlow(frame, BinOpSymbols[sub]!, a, b, pc, sp)
  }

  private execThrow(frame: Frame, val: Value, pc: number, sp: number): never {
    frame.pc = pc
    frame.sp = sp
    throw new Throw(val)
  }

  private execForIn(fcode: Code, val: Value, pc: number): Position {
    return new Position(forInKeys(this.ctx, val, fcode.siteAt(pc)!), "values", this.ctx.builtins.Array)
  }

  private onGeneratorStart(frame: Frame, pc: number, sp: number): void {
    execGeneratorStart(this, frame, pc, sp)
  }

  private onYield(frame: Frame, pc: number, sp: number): boolean {
    return execYield(this, frame, pc, sp)
  }

  private onResume(frame: Frame, bx: number, pc: number, sp: number): number {
    return execResume(frame, bx, pc, sp)
  }

  private onAwait(frame: Frame, flag: number, pc: number, sp: number): void {
    execAwait(this, frame, flag, pc, sp)
  }

  private onYstar(frame: Frame, slot: number, bx: number, pc: number, sp: number): number {
    return execYstar(frame, slot, bx, pc, sp)
  }

  private onYstarResult(frame: Frame, slot: number, bx: number, pc: number, sp: number): number {
    return execYstarResult(frame, slot, bx, pc, sp)
  }

  private failOpcode(op: number): never {
    throw new NotYetImplemented(`opcode ${op}`)
  }

  private execRot(regs: Array<unknown>, n: number, sp: number): void {
    const top = regs[sp - 1]
    for (let i = sp - 1; i > sp - 1 - n; i--) regs[i] = regs[i - 1]
    regs[sp - 1 - n] = top
  }

  private failTdz(frame: Frame, name: string, pc: number, sp: number): never {
    frame.pc = pc
    frame.sp = sp
    throw referenceError(`Cannot access '${name}' before initialization.`, frame.code.siteAt(pc))
  }

  private failPut(frame: Frame, name: string, current: unknown, pc: number, sp: number): never {
    frame.pc = pc
    frame.sp = sp
    if (current === HOLE) {
      throw referenceError(`Cannot access '${name}' before initialization.`, frame.code.siteAt(pc))
    }
    throw typeError(`Cannot assign to constant '${name}'.`, frame.code.siteAt(pc))
  }

  private execGetGlobal(frame: Frame, mode: number, name: string, pc: number, sp: number): Value {
    const fcode = frame.code
    const binding = this.ctx.globalScope.get(name)
    if (mode === 2) {
      frame.pc = pc
      frame.sp = sp - 1
      if (binding === undefined) throw referenceError(`Unknown identifier '${name}'.`, fcode.siteAt(pc))
      throw typeError(`Cannot assign to constant '${name}'.`, fcode.siteAt(pc))
    }
    if (binding === undefined) {
      if (mode === 1) return "undefined"
      frame.pc = pc
      frame.sp = sp
      throw referenceError(`Unknown identifier '${name}'.`, fcode.siteAt(pc))
    }
    return mode === 1 ? typeofValue(binding.value) : binding.value
  }

  private execArgs(frame: Frame, kind: number, bx: number): unknown {
    if (kind === 0) return new Arguments(this.ctx.builtins.Object, frame.args ?? [])
    if (kind === 1) return new Arr(this.ctx.builtins.Array, (frame.args ?? []).slice(bx))
    if (kind === 2) return frame.fn
    if (kind === 3) return frame.thisValue
    return frame.args?.[bx]
  }

  private execSetName(
    regs: Array<unknown>,
    consts: ReadonlyArray<ConstValue>,
    mode: number,
    bx: number,
    sp: number,
  ): void {
    const fn = regs[sp - 1]
    if (!(fn instanceof Fn)) return
    if (mode === 0) {
      define(fn, "name", consts[bx] as string, readonly)
      return
    }
    const key = regs[sp - 2]
    const name =
      key === IteratorSymbol
        ? "[Symbol.iterator]"
        : key === AsyncIteratorSymbol
          ? "[Symbol.asyncIterator]"
          : String(key)
    define(fn, "name", name, readonly)
  }

  private execToKey(frame: Frame, v: Value, pc: number, sp: number): boolean {
    if (!(v instanceof Obj) || isOpaque(v)) {
      frame.regs[sp - 1] = coerceToString(v)
      return false
    }
    frame.pc = pc
    frame.sp = sp - 1
    this.pushInternalCall("$vmToKey", [v], frame.code.siteAt(pc) ?? frame.origin)
    return true
  }

  private execIn(frame: Frame, lhs: Value, rhs: Value, pc: number, sp: number): boolean {
    frame.pc = pc
    frame.sp = sp
    return this.execBinarySlow(frame, "in", lhs, rhs, pc, sp)
  }

  private execNewArray(regs: Array<unknown>, n: number, sp: number): number {
    if (n === 0) {
      regs[sp] = new Arr(this.ctx.builtins.Array, contiguous<Value>())
      return sp + 1
    }
    const items = regs.slice(sp - n, sp) as Array<Value>
    sp -= n
    regs[sp] = new Arr(this.ctx.builtins.Array, items)
    return sp + 1
  }

  private execArrayAppend(regs: Array<unknown>, isHole: number, sp: number): number {
    if (isHole === 1) {
      const arr = regs[sp - 1] as Arr
      checkArrayLength(arr.items.length + 1)
      arr.items.length += 1
      return sp
    }
    const v = regs[--sp] as Value
    const arr = regs[sp - 1] as Arr
    checkArrayLength(arr.items.length + 1)
    arr.items.push(v)
    return sp
  }

  private execDefineField(
    regs: Array<unknown>,
    consts: ReadonlyArray<ConstValue>,
    computed: number,
    bx: number,
    sp: number,
  ): number {
    if (computed === 0) {
      const v = regs[--sp] as Value
      define(regs[sp - 1] as Obj, consts[bx] as string, v)
      return sp
    }
    const v = regs[--sp] as Value
    const k = regs[--sp] as PropertyKey
    define(regs[sp - 1] as Obj, k, v)
    return sp
  }

  private execCopyDataProps(fcode: Code, o: Obj, src: Value, pc: number): void {
    if (src !== null && src !== undefined) {
      assign(o, enumerableSource(this.ctx, "Object spread", src, fcode.siteAt(pc)!))
    }
  }

  private execCopyRest(fcode: Code, regs: Array<unknown>, n: number, pc: number, sp: number): number {
    const consumed = new Set<PropertyKey>()
    for (let i = sp - n; i < sp; i++) {
      const k = regs[i] as PropertyKey
      consumed.add(typeof k === "symbol" ? k : String(k))
    }
    sp -= n
    const src = regs[sp - 1] as Value
    const rest = new Obj(this.ctx.builtins.Object)
    assign(rest, enumerableSource(this.ctx, "Object destructuring", src, fcode.siteAt(pc)!), consumed)
    regs[sp - 1] = rest
    return sp
  }

  private execRegExp(fcode: Code, site: RegExpSite, pc: number): Value {
    try {
      return constructRegExp(this.ctx.builtins, [site.pattern, site.flags])
    } catch (err) {
      throw locate(err, fcode.siteAt(pc))
    }
  }

  private execBinopNum(sub: number, a: number, b: number): Value {
    switch (sub) {
      case 0:
        return a / b
      case 1:
        return a % b
      case 2:
        return a ** b
      case 3:
        return a & b
      case 4:
        return a | b
      case 5:
        return a ^ b
      case 6:
        return a << b
      case 7:
        return a >> b
      case 8:
        return a >>> b
      case 9:
        return a == b
      default:
        return a != b
    }
  }

  // `helper` converts an object in the prelude: `$vmToNumeric`, or `$vmInc` for `INC`.
  private execToNumericSlow(frame: Frame, flag: number, v: Value, pc: number, sp: number, helper = "$vmToNumeric") {
    const fcode = frame.code
    frame.pc = pc
    frame.sp = sp
    if (v instanceof Obj && !isOpaque(v)) {
      frame.sp = sp - 1
      this.pushInternalCall(helper, [flag, v], fcode.siteAt(pc) ?? frame.origin)
      return true
    }
    if (isOpaque(v)) {
      throw invalidData(`'${flag === 0 ? "++" : "--"}' requires a data value.`, fcode.siteAt(pc))
    }
    frame.regs[sp - 1] = coerceToNumber(v)
    return false
  }

  private execIncSlow(frame: Frame, flag: number, v: Value, pc: number, sp: number): boolean {
    if (this.execToNumericSlow(frame, flag, v, pc, sp, "$vmInc")) return true
    const n = frame.regs[sp - 1] as number
    frame.regs[sp - 1] = flag === 0 ? n + 1 : n - 1
    return false
  }

  private execToStringSlow(frame: Frame, flag: number, v: Value, pc: number, sp: number): boolean {
    if (flag === 1 || !(v instanceof Obj) || isOpaque(v)) {
      frame.regs[sp - 1] = coerceToString(v)
      return false
    }
    frame.pc = pc
    frame.sp = sp - 1
    this.pushInternalCall("$vmToString", [v], frame.code.siteAt(pc) ?? frame.origin)
    return true
  }

  private execConcat(regs: Array<unknown>, n: number, sp: number): number {
    let out = ""
    for (let i = sp - n; i < sp; i++) {
      out += regs[i] as string
      if (out.length > 16_777_216) checkStringLength(out.length)
    }
    sp -= n
    regs[sp] = out
    return sp + 1
  }

  private execThrowError(frame: Frame, bx: number, pc: number, sp: number): never {
    frame.pc = pc
    frame.sp = sp
    const site = frame.code.consts[bx] as ErrorSite
    throw new PendingThrow(site.type, site.message, frame.code.siteAt(pc), site.kind, site.suggestions)
  }

  private execEndFinally(frame: Frame, level: number, pc: number, sp: number): number {
    const fcode = frame.code
    const offset = fcode.finallyOffsets[level]!
    const fin = fcode.finallies
    const tag = frame.regs[fin[offset]!] as number
    if (tag === 1) {
      frame.pc = pc
      frame.sp = sp
      throw new Throw(frame.regs[fin[offset + 1]!] as Value)
    }
    return fin[offset + 4 + tag]!
  }

  private execReturnSlow(frame: Frame, v: Value, pc: number, sp: number): boolean {
    const frames = this.frames
    if (frame.mode === Mode.ASYNC || frame.mode === Mode.SETTLE) {
      frames.pop()
      const target = frame.target as SettlingTarget
      this.deliverAnswer(frame)
      this.release(frame)
      target.resolve(v)
      return true
    }
    if (frame.mode === Mode.GENERATOR) {
      completeGeneratorReturn(this, frame, v)
      return true
    }
    if (frame.mode === Mode.REJECT_ONLY) {
      frames.pop()
      this.deliverAnswer(frame)
      this.release(frame)
      return true
    }
    if (frame.mode === Mode.BOUNDARY_OUT) {
      frames.pop()
      this.release(frame)
      this.outcome = normal(v)
      return false
    }
    if (frame.mode === Mode.PROGRAM) {
      frame.pc = pc
      frame.sp = sp
      return this.finishProgram(frame, v)
    }
    frames.pop()
    this.release(frame)
    return true
  }

  private execCallSpread(frame: Frame, pc: number, sp: number): number {
    const regs = frame.regs
    const argsArr = regs[--sp] as Arr
    frame.pc = pc
    const callee = regs[sp - 1] as Value
    const thisVal = regs[sp - 2] as Value
    frame.sp = sp - 2
    return this.invokeCallable(frame, callee, thisVal, [...argsArr.items], callSiteOf(frame, pc), pc)
  }

  private execNew(frame: Frame, n: number, pc: number, sp: number): boolean {
    const fcode = frame.code
    const regs = frame.regs
    if (n === 255) {
      const callee = regs[sp - 1] as Value
      if (!(callee instanceof Builtin) || callee.construct === undefined) {
        frame.pc = pc
        frame.sp = sp
        throw notConstructible(callee, fcode.siteAt(pc) as NewExpression)
      }
      frame.sp = sp
      return false
    }
    frame.pc = pc
    const base = sp - n
    const callee = regs[base - 1] as Builtin
    const args = regs.slice(base, sp) as Array<Value>
    frame.sp = base - 1
    return this.execConstruct(frame, callee, args, callSiteOf(frame, pc))
  }

  private execNewSpread(frame: Frame, pc: number, sp: number): boolean {
    const regs = frame.regs
    const argsArr = regs[--sp] as Arr
    const callee = regs[--sp] as Builtin
    frame.pc = pc
    frame.sp = sp
    return this.execConstruct(frame, callee, [...argsArr.items], callSiteOf(frame, pc))
  }

  private execIterStepSlow(frame: Frame, custom: CustomIter, bx: number, pc: number, sp: number): boolean {
    const regs = frame.regs
    custom.done = true
    if (custom.rawGen) {
      const gen = custom.iterator as GeneratorObj
      if (gen.state === "completed") {
        frame.sp = sp
        frame.pc = bx
        return false
      }
      if (gen.state === "suspendedStart" || gen.state === "suspendedYield") {
        gen.state = "executing"
        frame.pc = pc
        frame.sp = sp
        resumeVmGenerator(this, gen, NEXT)
        return true
      }
    }
    regs[sp++] = custom.iterator
    regs[sp++] = custom.next
    frame.sp = sp
    frame.pc = pc + 1
    return false
  }

  private execIterResult(frame: Frame, slot: number, bx: number, pc: number, sp: number): number {
    const regs = frame.regs
    const res = regs[--sp] as Value
    frame.pc = pc
    frame.sp = sp
    if (!(res instanceof Obj)) {
      throw typeError("Iterator next() result must be an object.", frame.code.siteAt(pc))
    }
    const done = Boolean(this.readObjProp(res, "done", frame.code, pc))
    if (done) return bx
    ;(regs[slot] as CustomIter).done = false
    regs[sp] = this.readObjProp(res, "value", frame.code, pc)
    frame.sp = sp + 1
    return pc + 1
  }

  private execIterClose(frame: Frame, slot: number, bx: number, pc: number, sp: number): number {
    const regs = frame.regs
    const rec = regs[slot]
    if (!(rec instanceof CustomIter) || rec.done) {
      frame.sp = sp
      return bx
    }
    frame.pc = pc
    frame.sp = sp
    rec.done = true
    const ret = this.readObjProp(rec.iterator, "return", frame.code, pc)
    if (ret === undefined || ret === null) return bx
    const method = requireIteratorMethod(ret, "Iterator return", frame.code.siteAt(pc))
    regs[sp++] = rec.iterator
    regs[sp++] = method
    frame.sp = sp
    return pc + 1
  }

  private execIterAppendAll(frame: Frame, slot: number, bx: number, pc: number, sp: number): number {
    const rec = frame.regs[slot]
    if (!(rec instanceof Position)) return bx
    const arr = frame.regs[sp - 1] as Arr
    frame.pc = pc
    frame.sp = sp
    for (let step = rec.step(); !step.done; step = rec.step()) {
      checkArrayLength(arr.items.length + 1)
      arr.items.push(step.value)
    }
    return pc + 1
  }

  private readObjProp(target: Obj, key: string | symbol, fcode: Code, pc: number): Value {
    for (let cur: Obj | null = target; cur !== null; cur = cur.proto) {
      if (cur.props.size === 0) continue
      const slot = cur.props.get(key)
      if (slot !== undefined) {
        if ("value" in slot) return slot.value
        if (slot.get === undefined) return undefined
        try {
          return slot.get(target)
        } catch (err) {
          throw locate(err, fcode.siteAt(pc))
        }
      }
    }
    return undefined
  }

  unwind(rawError: unknown): boolean {
    // An interruption skips every handler, but still completes each frame by its mode: a frame that settles a
    // promise rejects it, so whatever awaits that promise is interrupted in turn.
    const interrupted = rawError instanceof Interruption
    const error = interrupted ? rawError : locate(rawError, this.currentSite())

    if (this.frames.length === 0) {
      this.outcome = abrupt(error)
      return false
    }

    while (this.frames.length > 0) {
      const frame = this.frames[this.frames.length - 1]!
      const fcode = frame.code
      const handlers = fcode.handlers
      const faultPc = frame.pc
      for (let i = 0; !interrupted && i < handlers.length; i += 4) {
        const start = handlers[i]!
        const end = handlers[i + 1]!
        if (faultPc >= start && faultPc < end) {
          const target = handlers[i + 2]!
          const depth = handlers[i + 3]!
          const sp = fcode.locals + depth
          frame.regs[sp] = materialize(this.ctx, error)
          frame.sp = sp + 1
          frame.pc = target
          return true
        }
      }

      this.frames.pop()
      const mode = frame.mode
      if (mode === Mode.CALLER) {
        this.release(frame)
        continue
      }
      if (mode === Mode.GENERATOR) {
        if (unwindGenerator(this, frame, error)) {
          return this.frames.length > 0
        }
        continue
      }
      if (mode === Mode.ASYNC || mode === Mode.SETTLE || mode === Mode.REJECT_ONLY) {
        const target = frame.target as SettlingTarget
        this.deliverAnswer(frame)
        this.release(frame)
        target.reject(error)
        return this.frames.length > 0
      }
      this.release(frame)
      if (mode === Mode.PROGRAM || mode === Mode.BOUNDARY_OUT) {
        this.outcome = abrupt(error)
        return false
      }
    }
    return false
  }

  private finishProgram(frame: Frame, value: Value): boolean {
    if (!isThenable(value)) {
      let fast: ReturnType<typeof tryFastBoundaryOrJson>
      try {
        fast = tryFastBoundaryOrJson(this.ctx.builtins, value, true, VISIT_BUDGET)
      } catch (error) {
        this.frames.pop()
        this.release(frame)
        this.outcome = abrupt(error)
        return false
      }
      if (fast.ok) {
        this.frames.pop()
        this.release(frame)
        this.outcome = normal(fast.json)
        return false
      }
    }
    this.frames.pop()
    this.release(frame)
    this.pushInternal(
      internalCode("$vmCross"),
      [new Arr(this.ctx.builtins.Array, [value])],
      undefined,
      Mode.BOUNDARY_OUT,
    )
    return true
  }

  private makeClosure(parentCode: Code, fnIndex: number, regs: Array<unknown>, cells: ReadonlyArray<Cell>): Fn {
    const childCode = this.codesOf(parentCode)[fnIndex]!
    const caps = childCode.captures
    let childCells: ReadonlyArray<Cell>
    if (caps.length === 0) {
      childCells = EMPTY_CELLS
    } else {
      const arr = contiguous<Cell>()
      for (let i = 0; i < caps.length; i += 2) {
        arr.push(caps[i] === 0 ? (regs[caps[i + 1]!] as Cell) : cells[caps[i + 1]!]!)
      }
      childCells = arr
    }
    const fn = new Fn(this.ctx.builtins.Function, childCode, childCells)
    if ((childCode.flags & CodeFlags.GENERATOR) !== 0) {
      const isAsync = (childCode.flags & CodeFlags.ASYNC) !== 0
      define(fn, "prototype", new Obj(isAsync ? this.ctx.builtins.AsyncGenerator : this.ctx.builtins.Generator), hidden)
    }
    return fn
  }

  private getTemplateObject(fcode: Code, site: TemplateSite): Arr {
    const key = `${fcode.source.id}:${site.nodeIndex}`
    const cached = this.templates.get(key)
    if (cached !== undefined) return cached
    const arrayProto = this.ctx.builtins.Array
    const strings = new Arr(arrayProto, [...site.cooked])
    define(strings, "raw", new Arr(arrayProto, [...site.raw]), frozen)
    this.templates.set(key, strings)
    return strings
  }

  private execImport(frame: Frame, kind: number, k: number, pc: number, sp: number): number {
    const fcode = frame.code
    const siteNode = fcode.siteAt(pc)
    if (kind === ImportKind.DYNAMIC) {
      const specifier = frame.regs[sp - 1] as string
      const promise = capability(this.ctx, siteNode)
      try {
        promise.resolve(this.ctx.namespace(specifier, siteNode))
      } catch (err) {
        if (!(err instanceof PendingThrow)) throw err
        promise.reject(err)
      }
      frame.regs[sp - 1] = promise.promise
      return sp
    }
    const site = fcode.consts[k] as ImportSite
    if (kind === ImportKind.SIDE_EFFECT) {
      this.ctx.module(site.specifier, siteNode)
      return sp
    }
    if (kind === ImportKind.DEFAULT) {
      frame.regs[sp] = this.ctx.module(site.specifier, siteNode)
      return sp + 1
    }
    const ns = this.ctx.namespace(site.specifier, siteNode)
    if (kind === ImportKind.NAMESPACE) {
      frame.regs[sp] = ns
      return sp + 1
    }
    const imported = site.imported!
    if (!hasOwn(ns, imported)) {
      throw syntaxError(`"${site.specifier}" has no export named "${imported}".`, siteNode)
    }
    frame.regs[sp] = getOwn(ns, imported)
    return sp + 1
  }

  private execGetProp(frame: Frame, o: Value, key: string, mode: number, pc: number, sp: number): number {
    const regs = frame.regs
    if (mode !== 2 && o instanceof Obj && !(o instanceof PromiseObj)) {
      const v = key === "length" && o instanceof Arr ? o.items.length : this.readObjProp(o, key, frame.code, pc)
      return writeRead(regs, sp - 1, mode, o, v)
    }
    if (mode !== 2 && typeof o === "string") {
      const v = key === "length" ? o.length : this.readObjProp(this.ctx.builtins.String, key, frame.code, pc)
      return writeRead(regs, sp - 1, mode, o, v)
    }
    if (o instanceof ToolReference) return writeRead(regs, sp - 1, mode, undefined, new ToolReference([...o.path, key]))
    const site = frame.code.siteAt(pc)!
    if (mode === 2) {
      regs[sp - 1] = destructuredProperty(this.ctx.builtins, o, key, site)
      return sp
    }
    return this.readMember(regs, sp - 1, mode, o, key, site)
  }

  private execGetElem(frame: Frame, o: Value, keyVal: Value, mode: number, pc: number, sp: number): boolean {
    if (mode === 0) {
      if (typeof o === "string" && typeof keyVal === "number" && keyVal >= 0 && (keyVal | 0) === keyVal) {
        frame.regs[sp - 2] = o[keyVal]
        frame.sp = sp - 1
        return false
      }
      if (o instanceof Obj && !(o instanceof PromiseObj)) {
        if (typeof keyVal === "number" && !(o instanceof Arr)) {
          if (
            o.constructor === Obj &&
            (o.props.size === 0 || (o.props.size === 1 && o.props.has("length"))) &&
            o.proto === this.ctx.builtins.Object &&
            o.proto.intrinsic > 0
          ) {
            frame.regs[sp - 2] = undefined
            frame.sp = sp - 1
            return false
          }
        }
        if (typeof keyVal === "string" && o.constructor === Obj) {
          frame.regs[sp - 2] = this.readObjProp(o, keyVal, frame.code, pc)
          frame.sp = sp - 1
          return false
        }
      }
    }
    const site = frame.code.siteAt(pc)!
    const memberNode = site as MemberExpression
    if (mode !== 2) requireMemberBase(memberNode, o, keyVal)
    if (keyVal instanceof Obj && !isOpaque(keyVal)) {
      frame.sp = sp - 2
      this.pushInternalCall("$vmGetElem", [o, keyVal], memberNode.property ?? site)
      return true
    }
    const key = propertyKey(keyVal)
    if (mode === 2) {
      frame.regs[sp - 2] = destructuredProperty(this.ctx.builtins, o, key, site)
      frame.sp = sp - 1
      return false
    }
    frame.sp = this.readMember(frame.regs, sp - 2, mode, o, key, site)
    return false
  }

  // Reads `o[key]` for the member expression at `site` into `regs` at `at`; see `writeRead`.
  private readMember(
    regs: Array<unknown>,
    at: number,
    mode: number,
    o: Value,
    key: PropertyKey,
    site: AstNode,
  ): number {
    const ref = this.resolveMember(o, key, site)
    if (ref instanceof ToolReference) return writeRead(regs, at, mode, undefined, ref)
    if ("value" in ref) return writeRead(regs, at, mode, undefined, ref.value)
    return writeRead(regs, at, mode, ref.receiver, readReference(ref, site as MemberExpression))
  }

  // The reference `o[key]` that the member expression at `site` names.
  private resolveMember(o: Value, key: PropertyKey, site: AstNode) {
    const member = site as MemberExpression
    return resolveProperty(this.ctx.builtins, o, key, member.object ?? site, member.property ?? site)
  }

  private execPutProp(fcode: Code, o: Value, key: PropertyKey, v: Value, pc: number): void {
    if (!(o instanceof Obj)) {
      const site = fcode.siteAt(pc)!
      const ref = resolveProperty(this.ctx.builtins, o, key, site, site)
      writableReference(ref, site as MemberExpression)
      return
    }
    try {
      assignToReference(o, key, v, undefined!)
    } catch (err) {
      throw locate(err, fcode.siteAt(pc))
    }
  }

  private execPutElem(fcode: Code, o: Value, keyVal: Value, v: Value, pc: number): void {
    this.execPutProp(fcode, o, propertyKey(keyVal), v, pc)
  }

  private execDeleteProp(fcode: Code, o: Value, key: PropertyKey, pc: number): boolean {
    const site = fcode.siteAt(pc)!
    const ref = this.resolveMember(o, key, site)
    if (ref instanceof ToolReference || "value" in ref || ref.receiver !== ref.target) {
      throw invalidData("Only data fields may be deleted.", site)
    }
    if (remove(ref.target, ref.key)) return true
    throw typeError(`Cannot delete property '${String(ref.key)}'.`, site)
  }

  private execDeleteElem(frame: Frame, o: Value, keyVal: Value, pc: number, sp: number): boolean {
    const site = frame.code.siteAt(pc)!
    requireMemberBase(site as MemberExpression, o, keyVal)
    if (keyVal instanceof Obj && !isOpaque(keyVal)) {
      frame.sp = sp - 1
      this.pushInternalCall("$vmDeleteElem", [o, keyVal], site)
      return true
    }
    frame.regs[sp - 1] = this.execDeleteProp(frame.code, o, propertyKey(keyVal), pc)
    frame.sp = sp
    return false
  }

  private execCheckBase(fcode: Code, kind: number, bx: number, regs: Array<unknown>, sp: number, pc: number): void {
    const base = regs[kind === CheckBaseKind.READ || kind === CheckBaseKind.WRITE_ELEM ? sp - 2 : sp - 1] as Value
    if (base instanceof Obj && !(base instanceof PromiseObj)) return
    const site = fcode.siteAt(pc)!
    if (kind === CheckBaseKind.DESTRUCTURE) {
      if (base === null || base === undefined) {
        throw typeError(`Cannot destructure ${describeValue(base)} as it is ${base}.`, site)
      }
      return
    }
    const memberNode = site as MemberExpression
    if (kind === CheckBaseKind.READ) {
      requireMemberBase(memberNode, base, regs[sp - 1] as Value)
      return
    }
    const key = kind === CheckBaseKind.WRITE_PROP ? (fcode.consts[bx] as string) : propertyKey(regs[sp - 1] as Value)
    readReference(writableReference(this.resolveMember(base, key, site), memberNode), memberNode)
  }

  private execBinarySlow(frame: Frame, op: string, a: Value, b: Value, pc: number, sp: number): boolean {
    const fcode = frame.code
    const site = fcode.siteAt(pc) ?? frame.origin
    if (a instanceof Obj || b instanceof Obj) {
      const conv = operatorConversion(op, a, b)
      if (conv !== undefined) {
        frame.sp = sp - 1
        this.pushInternalCall("$vmBinary", [op, a, b], site)
        return true
      }
    }
    frame.regs[sp - 1] = applyBinaryOperator(op, a, b, site!)
    return false
  }

  private execUnarySlow(frame: Frame, sub: number, v: Value, pc: number, sp: number): boolean {
    if (sub === 3) {
      frame.regs[sp - 1] = typeofValue(v)
      return false
    }
    if (sub === 4) {
      frame.regs[sp - 1] = undefined
      return false
    }
    const fcode = frame.code
    const site = fcode.siteAt(pc) ?? frame.origin
    if (v instanceof Obj && !isOpaque(v)) {
      frame.sp = sp - 1
      this.pushInternalCall("$vmUnary", [sub, v], site)
      return true
    }
    if (isOpaque(v)) throw invalidData("Unary operators require data values.", site)
    const n = coerceToNumber(v)
    frame.regs[sp - 1] = sub === UnaryOp.NEG ? -n : sub === UnaryOp.PLUS ? +n : ~n
    return false
  }

  private execCallSlow(frame: Frame, n: number, pc: number, sp: number): number {
    const regs = frame.regs
    const base = sp - n
    const callee = regs[base - 1] as Value
    const thisVal = regs[base - 2] as Value
    if (callee instanceof Native) {
      conversions.count = 0
      const args =
        n === 0
          ? []
          : n === 1
            ? [regs[base] as Value]
            : n === 2
              ? [regs[base] as Value, regs[base + 1] as Value]
              : (regs.slice(base, sp) as Array<Value>)
      frame.pc = pc
      frame.sp = base - 2
      const site = callee.callback && callee.call.length < 3 ? undefined : callSiteOf(frame, pc)
      const res = callee.call(thisVal, args, site)
      if (this.tripEvery === 0) this.fuel -= NATIVE_FUEL
      if (res === null || typeof res !== "object" || res instanceof Obj) {
        normalizeItems(res)
        regs[base - 2] = res
        frame.sp = base - 1
        return 0
      }
      return this.settleNativeResult(frame, res, callee, thisVal, args, false, site ?? callSiteOf(frame, pc), pc)
    }
    const args = regs.slice(base, sp) as Array<Value>
    frame.sp = base - 2
    return this.invokeCallable(frame, callee, thisVal, args, callSiteOf(frame, pc), pc)
  }

  /**
   * Dispatches a call to `callee`. Returns `0` if synchronous value pushed, `1` if a frame was entered, `2` if the job
   * blocks on a host call.
   */
  private invokeCallable(
    callerFrame: Frame,
    callee: Value | VmIntrinsic | VmInternalFn,
    thisVal: Value,
    args: Array<Value>,
    site: AstNode | undefined,
    pc: number,
  ): number {
    while (callee instanceof BoundFn) {
      thisVal = callee.boundThis
      args = [...callee.boundArgs, ...args]
      callee = callee.target
    }

    if (callee instanceof VmIntrinsic) {
      let res: NativeResult
      try {
        res = callee.call(args)
      } catch (err) {
        throw locate(err, site ?? this.currentSite())
      }
      if (res instanceof Convert) {
        callerFrame.regs[callerFrame.sp++] = res as unknown as Value
        return 0
      }
      return this.settleNativeResult(callerFrame, res, undefined, thisVal, args, false, site, pc)
    }

    if (callee instanceof VmInternalFn) {
      const callArgs = callee.boundArgs !== undefined ? [...callee.boundArgs, ...args] : args
      const f = this.pushInternal(callee.code, callArgs, site ?? callerFrame.origin)
      if ((callee.code.flags & CodeFlags.NEEDS_ARGS) !== 0) f.args = callArgs
      f.thisValue = thisVal
      this.fuel--
      return 1
    }

    if (callee instanceof Fn) {
      const code = callee.code
      const counted = (code.flags & CodeFlags.INTERNAL) === 0
      if (counted && this.depth > MAX_CALL_DEPTH) {
        throw rangeError("Maximum call stack size exceeded", site ?? this.currentSite())
      }
      const isGenerator = (code.flags & CodeFlags.GENERATOR) !== 0
      const isAsync = (code.flags & CodeFlags.ASYNC) !== 0
      const origin = site ?? callerFrame.origin
      if (isAsync && !isGenerator) {
        const resolving = this.scheduler.resolving(this.scheduler.newPromise(), site ?? this.currentSite())
        this.pushFn(callee, thisVal, args, origin, Mode.ASYNC, resolving, resolving.promise)
      } else this.pushFn(callee, thisVal, args, origin, Mode.CALLER)
      this.fuel--
      return 1
    }

    if (callee instanceof Builtin) {
      conversions.count = 0
      let res: NativeResult
      try {
        res = callee.invoke(thisVal, args, site ?? this.currentSite())
      } catch (err) {
        throw locate(err, site ?? this.currentSite())
      }
      if (this.tripEvery === 0) this.fuel -= NATIVE_FUEL
      return this.settleNativeResult(callerFrame, res, callee, thisVal, args, false, site, pc)
    }

    if (callee instanceof ToolReference) {
      if (callee.path.length === 0) {
        const callNode = site as { readonly callee?: Expression } | undefined
        throw typeError("The tools root is not callable.", callNode?.callee ?? site)
      }
      return this.hostResult(callerFrame, callTool(this, this.hosts, callee.path, args, site ?? this.currentSite()))
    }

    const callNode = site as { readonly callee?: Expression } | undefined
    throw notAFunction(callNode?.callee, site ?? this.currentSite())
  }

  private execConstruct(callerFrame: Frame, ctor: Builtin, args: Array<Value>, site: AstNode | undefined): boolean {
    conversions.count = 0
    let res: NativeResult
    try {
      res = ctor.construct!(args, ctor, site ?? this.currentSite())
    } catch (err) {
      throw locate(err, site ?? this.currentSite())
    }
    return this.settleNativeResult(callerFrame, res, ctor, ctor, args, true, site, callerFrame.pc) === 1
  }

  private settleNativeResult(
    callerFrame: Frame,
    res: NativeResult,
    callable: Builtin | undefined,
    thisOrNewTarget: Value,
    args: Array<Value>,
    constructing: boolean,
    site: AstNode | undefined,
    pc: number,
  ): number {
    if (res instanceof Invoke) {
      normalizeItems(res.thisValue)
      for (let i = 0; i < res.args.length; i++) normalizeItems(res.args[i])
      return this.invokeCallable(callerFrame, res.callable, res.thisValue, res.args, res.site ?? site, pc)
    }
    if (res instanceof Resume) {
      resumeVmGenerator(this, res.generator, res.request)
      return 1
    }
    if ((res as unknown) === BLOCK) return 2
    if (res instanceof Convert) {
      const builtins = this.ctx.builtins
      this.pushInternalCall(
        "$vmConvert",
        [
          callable!,
          thisOrNewTarget,
          new Arr(builtins.Array, args),
          constructing,
          new Arr(builtins.Array, []),
          res as unknown as Value,
        ],
        site ?? callerFrame.origin,
      )
      return 1
    }
    if (res instanceof Push) {
      const kindName = res.kind
      const slots = res.slots
      const builtins = this.ctx.builtins
      if (kindName === "JSON.stringify") {
        const [value, replacer, properties, indent] = slots as [
          Value,
          Callable | undefined,
          Array<string> | undefined,
          string | number | undefined,
        ]
        if (replacer === undefined && properties === undefined) {
          const fast = tryFastBoundaryOrJson(builtins, value, false, VISIT_BUDGET)
          if (fast.ok) {
            const text = JSON.stringify(fast.json, null, indent)
            if (text !== undefined) checkStringLength(text.length)
            callerFrame.regs[callerFrame.sp++] = text
            return 0
          }
        }
        this.pushInternalCall(
          "$vmJsonWalk",
          [replacer, value, properties !== undefined ? new Arr(builtins.Array, properties) : null, indent],
          site ?? callerFrame.origin,
        )
        return 1
      }
      if (kindName === "AsyncFromSyncIterator") {
        return handleAdapterPush(this, callerFrame, slots)
      }
      const promiseHandled = this.scheduler.handlePromisePush(callerFrame, kindName, slots, site ?? callerFrame.origin)
      if (promiseHandled !== undefined) return promiseHandled
      if (kindName === "search") {
        return this.hostResult(
          callerFrame,
          callSearch(this, this.hosts, slots[0] as Array<Value>, site ?? callerFrame.origin),
        )
      }
      if (kindName === "extension call") {
        return this.hostResult(callerFrame, callExtension(this.ctx, this.hosts, slots, site ?? callerFrame.origin))
      }
      throw new NotYetImplemented(`Push kind: ${kindName}`)
    }
    callerFrame.regs[callerFrame.sp++] = res as Value
    return 0
  }

  // A host operation's answer, by `invokeCallable`'s convention: a value is pushed (0), a frame entered (1), or the job
  // blocks (2).
  private hostResult(callerFrame: Frame, result: HostResult): number {
    if (result === ENTERED) return 1
    if (result === BLOCK) return 2
    callerFrame.regs[callerFrame.sp++] = result
    return 0
  }

  /**
   * Enters the program function `fn`, from the call at `origin`. A frame in another `mode` than `CALLER` settles
   * `target`, and hands the caller `answer` when it ends.
   */
  pushFn(
    fn: Fn,
    thisValue: Value,
    args: Array<Value>,
    origin: AstNode | undefined,
    mode: FrameMode,
    target?: unknown,
    answer?: Value,
  ): void {
    const code = fn.code
    const counted = (code.flags & CodeFlags.INTERNAL) === 0
    if (counted) this.depth++
    const f = this.acquire(code)
    f.fn = fn
    f.cells = fn.cells.length === 0 ? EMPTY_CELLS : fn.cells
    f.counted = counted
    if ((code.flags & CodeFlags.SIMPLE_PARAMS) !== 0) {
      for (let i = 0; i < code.params; i++) f.regs[i] = i < args.length ? args[i] : undefined
    }
    f.args = (code.flags & CodeFlags.NEEDS_ARGS) !== 0 ? args : undefined
    f.thisValue = thisValue
    f.origin = counted ? undefined : origin
    f.pc = 0
    f.sp = code.locals
    f.mode = mode
    f.target = target
    f.answer = answer
    this.frames.push(f)
  }

  private pushInternalCall(name: string, args: Array<Value>, origin: AstNode | undefined): void {
    this.pushInternal(internalCode(name), args, origin)
  }

  /** Runs an internal prelude function at the call `origin`; see `HostVm.pushInternal`. */
  pushInternal(
    code: Code,
    args: ReadonlyArray<unknown>,
    origin: AstNode | undefined,
    mode: FrameMode = Mode.CALLER,
    target?: unknown,
    answer?: Value,
  ): Frame {
    const f = this.acquire(code)
    f.fn = null
    f.cells = EMPTY_CELLS
    for (let i = 0; i < code.params; i++) f.regs[i] = i < args.length ? args[i] : undefined
    f.thisValue = undefined
    f.args = undefined
    f.origin = origin
    f.pc = 0
    f.sp = code.locals
    f.mode = mode
    f.target = target
    f.answer = answer
    f.counted = false
    this.frames.push(f)
    return f
  }

  private execIterOpen(frame: Frame, context: number, pc: number, sp: number): number {
    const v = frame.regs[sp - 1] as Value
    const fcode = frame.code
    if (
      context !== IterContext.FOR_AWAIT &&
      context !== IterContext.ASYNC_DELEGATE &&
      context !== IterContext.DELEGATE
    ) {
      const cursor = builtinCursor(this.ctx.builtins, v)
      if (cursor !== undefined) {
        if (cursor instanceof Position) {
          frame.regs[sp - 1] = cursor
        } else {
          frame.regs[sp - 1] = this.customIter(cursor.iterator, cursor.next)
        }
        return skipJump(fcode.code, pc)
      }
    }
    const site = fcode.siteAt(pc) ?? frame.origin
    if (context === IterContext.FOR_AWAIT || context === IterContext.ASYNC_DELEGATE) {
      if (this.openWithMethod(frame, v, AsyncIteratorSymbol, site, sp)) return pc + 1
      const cursor = builtinCursor(this.ctx.builtins, v)
      if (cursor !== undefined) {
        const adapter = new AsyncFromSyncIterator(this.ctx.builtins.AsyncFromSyncIterator, cursor, site!)
        frame.regs[sp - 1] = new CustomIter(adapter, get(adapter, "next"))
        return skipJump(fcode.code, pc)
      }
      if (v instanceof Obj) {
        const syncMethod = readProperty(v, IteratorSymbol, site)
        if (syncMethod !== undefined && syncMethod !== null) {
          const callable = requireIteratorMethod(syncMethod, "Iterator method", site)
          const openCode = internalCode("$vmOpenSyncForAsync")
          frame.regs[sp - 1] = undefined
          frame.regs[sp] = new VmInternalFn(openCode, [v, callable])
          frame.sp = sp + 1
          return pc + 1
        }
      }
      if (context === IterContext.FOR_AWAIT) {
        throw invalidData(`for await...of requires an iterable value, received ${describeValue(v)}.`, site)
      }
      throw typeError("yield* requires a compatible iterable value.", site)
    }

    if (context === IterContext.DELEGATE) {
      if (this.openWithMethod(frame, v, IteratorSymbol, site, sp)) return pc + 1
      const cursor = builtinCursor(this.ctx.builtins, v)
      if (cursor !== undefined) {
        const iterObj =
          cursor instanceof Position ? new IteratorObj(this.ctx.builtins.Iterator, cursor) : cursor.iterator
        frame.regs[sp - 1] = new CustomIter(iterObj, get(iterObj, "next"))
        return skipJump(fcode.code, pc)
      }
      throw typeError("yield* requires a compatible iterable value.", site)
    }

    if (this.openWithMethod(frame, v, IteratorSymbol, site, sp)) return pc + 1
    if (context === IterContext.FOR_OF) {
      throw invalidData(`for...of requires an iterable value, received ${describeValue(v)}.`, site)
    }
    if (context === IterContext.DESTRUCTURE) {
      throw typeError("Array destructuring requires a supported iterable value.", site)
    }
    throw typeError(
      site?.type === "SpreadElement" && (fcode.sourceObj?.nodes.includes(site) ?? false)
        ? "Spread requires a synchronous iterable."
        : "Value is not iterable.",
      site,
    )
  }

  private execIterInit(frame: Frame, context: number, pc: number, sp: number): void {
    const site = frame.code.siteAt(pc) ?? frame.origin
    const v = frame.regs[sp - 1] as Value
    if (context === IterContext.CHECK_OBJECT) {
      requireIteratorObject(v, "Iterator return() result", site)
      return
    }
    const obj = requireIteratorObject(v, "Iterator method result", site)
    const next = requireIteratorMethod(readProperty(obj, "next", site), "Iterator next", site)
    frame.regs[sp - 1] = this.customIter(obj, next)
  }

  // Opens `v` with its own `symbol` method, when it has one: the next instruction calls it.
  private openWithMethod(frame: Frame, v: Value, symbol: symbol, site: AstNode | undefined, sp: number): boolean {
    if (!(v instanceof Obj)) return false
    const method = readProperty(v, symbol, site)
    if (method === undefined || method === null) return false
    frame.regs[sp - 1] = v
    frame.regs[sp] = requireIteratorMethod(method, "Iterator method", site)
    frame.sp = sp + 1
    return true
  }

  // A synchronous generator's (or iterator helper's) own `next` is stepped without a call to it.
  private customIter(iterator: Obj, next: Value): CustomIter {
    const custom = new CustomIter(iterator, next)
    const builtins = this.ctx.builtins
    custom.rawGen =
      iterator instanceof GeneratorObj &&
      !iterator.asynchronous &&
      (next === get(builtins.Generator, "next") || next === get(builtins.IteratorHelper, "next"))
    return custom
  }

  // Decodes one or two `EXTRA` prefix words and dispatches the widened instruction.
  // Negative returns encode outer control: `-1` = `continue outer`, `-2` = `return 0`, `-3` = `return 1`, `-4` = `return 2`.
  private execExtra(frame: Frame, w: number, pc: number, sp: number): number {
    const code = frame.code.code
    const w1 = code[pc + 1]!
    const op1 = w1 & 0xff
    if (op1 === Op.EXTRA) {
      const w2 = code[pc + 2]!
      const wideA = ((w >>> 16) << 16) | (w1 & 0xff00) | ((w2 >>> 8) & 0xff)
      const wideBx = ((w1 >>> 16) << 16) | (w2 >>> 16)
      frame.pc = pc + 2
      frame.sp = sp
      return this.execWide(frame, w2 & 0xff, wideA, wideBx, pc + 2)
    }
    const wideA = (w & 0xff00) | ((w1 >>> 8) & 0xff)
    const wideBx = ((w >>> 16) << 16) | (w1 >>> 16)
    frame.pc = pc + 1
    frame.sp = sp
    return this.execWide(frame, op1, wideA, wideBx, pc + 1)
  }

  // An instruction after its `EXTRA` prefix: the same work as in `exec`, with wide `a` and `bx`.
  private execWide(frame: Frame, op: number, a: number, bx: number, pc: number): number {
    const fcode = frame.code
    const regs = frame.regs
    const consts = fcode.consts
    const cells = frame.cells
    let sp = frame.sp
    switch (op) {
      case Op.PUSH_UNDEF:
        regs[sp++] = undefined
        frame.sp = sp
        return pc + 1
      case Op.PUSH_NULL:
        regs[sp++] = null
        frame.sp = sp
        return pc + 1
      case Op.PUSH_BOOL:
        regs[sp++] = a === 1
        frame.sp = sp
        return pc + 1
      case Op.PUSH_CONST:
        regs[sp++] = consts[bx]
        frame.sp = sp
        return pc + 1
      case Op.POP:
        frame.sp = sp - 1
        return pc + 1
      case Op.POPN:
        frame.sp = sp - bx
        return pc + 1
      case Op.DUP:
        regs[sp] = regs[sp - 1]
        frame.sp = sp + 1
        return pc + 1
      case Op.PICK:
        regs[sp] = regs[sp - 1 - a]
        frame.sp = sp + 1
        return pc + 1
      case Op.ROT:
        this.execRot(regs, a, sp)
        return pc + 1
      case Op.GET_LOCAL:
      case Op.GET_CELL: {
        const v = op === Op.GET_LOCAL ? regs[bx] : (regs[bx] as Cell).v
        if (v === HOLE) this.failTdz(frame, fcode.localNames[bx]!, pc, sp)
        regs[sp++] = v
        frame.sp = sp
        return pc + 1
      }
      case Op.PUT_LOCAL: {
        const v = regs[--sp]
        frame.sp = sp
        if (a !== PutKind.INIT && (regs[bx] === HOLE || a === PutKind.CONST)) {
          this.failPut(frame, fcode.localNames[bx]!, regs[bx], pc, sp)
        }
        regs[bx] = v
        return pc + 1
      }
      case Op.PUT_CELL:
      case Op.PUT_UPVAL: {
        const v = regs[--sp]
        frame.sp = sp
        const cell = op === Op.PUT_CELL ? (regs[bx] as Cell) : cells[bx]!
        if (a !== PutKind.INIT && (cell.v === HOLE || a === PutKind.CONST)) {
          this.failPut(frame, (op === Op.PUT_CELL ? fcode.localNames : fcode.upvalNames)[bx]!, cell.v, pc, sp)
        }
        cell.v = v
        return pc + 1
      }
      case Op.HOLE_LOCAL:
        regs[bx] = HOLE
        return pc + 1
      case Op.NEW_CELL:
        regs[bx] = new Cell(a === 1 ? regs[bx] : HOLE)
        return pc + 1
      case Op.COPY_CELL:
        regs[bx] = new Cell((regs[bx] as Cell).v)
        return pc + 1
      case Op.GET_UPVAL: {
        const v = cells[bx]!.v
        if (v === HOLE) this.failTdz(frame, fcode.upvalNames[bx]!, pc, sp)
        regs[sp++] = v
        frame.sp = sp
        return pc + 1
      }
      case Op.GET_GLOBAL:
        regs[sp] = this.execGetGlobal(frame, a, consts[bx] as string, pc, sp)
        frame.sp = sp + 1
        return pc + 1
      case Op.GET_INTRINSIC:
        regs[sp++] = this.getIntrinsic(consts[bx] as string)
        frame.sp = sp
        return pc + 1
      case Op.ARGS:
        regs[sp++] = this.execArgs(frame, a, bx)
        frame.sp = sp
        return pc + 1
      case Op.CLOSURE:
        regs[sp++] = this.makeClosure(fcode, bx, regs, cells)
        frame.sp = sp
        return pc + 1
      case Op.SET_NAME:
        this.execSetName(regs, consts, a, bx, sp)
        return pc + 1
      case Op.IMPORT:
        frame.sp = this.execImport(frame, a, bx, pc, sp)
        return pc + 1
      case Op.GET_PROP:
        frame.sp = this.execGetProp(frame, regs[sp - 1] as Value, consts[bx] as string, a, pc, sp)
        return pc + 1
      case Op.GET_ELEM:
        if (this.execGetElem(frame, regs[sp - 2] as Value, regs[sp - 1] as Value, a, pc, sp)) return -1
        return pc + 1
      case Op.PUT_PROP: {
        const v = regs[--sp] as Value
        frame.sp = sp
        this.execPutProp(fcode, regs[sp - 1] as Value, consts[bx] as string, v, pc)
        regs[sp - 1] = v
        return pc + 1
      }
      case Op.PUT_ELEM: {
        const v = regs[--sp] as Value
        const keyVal = regs[--sp] as Value
        frame.sp = sp
        this.execPutElem(fcode, regs[sp - 1] as Value, keyVal, v, pc)
        regs[sp - 1] = v
        return pc + 1
      }
      case Op.DELETE_PROP:
        regs[sp - 1] = this.execDeleteProp(fcode, regs[sp - 1] as Value, consts[bx] as string, pc)
        return pc + 1
      case Op.DELETE_ELEM: {
        const keyVal = regs[--sp] as Value
        frame.sp = sp
        if (this.execDeleteElem(frame, regs[sp - 1] as Value, keyVal, pc, sp)) return -1
        return pc + 1
      }
      case Op.CHECK_BASE:
        this.execCheckBase(fcode, a, bx, regs, sp, pc)
        return pc + 1
      case Op.TO_KEY: {
        const v = regs[sp - 1] as Value
        if (typeof v !== "string" && typeof v !== "number" && typeof v !== "symbol") {
          if (this.execToKey(frame, v, pc, sp)) return -1
        }
        return pc + 1
      }
      case Op.IN: {
        const rhs = regs[--sp] as Value
        frame.sp = sp
        if (this.execIn(frame, regs[sp - 1] as Value, rhs, pc, sp)) return -1
        return pc + 1
      }
      case Op.INSTANCEOF: {
        const rhs = regs[--sp] as Value
        frame.sp = sp
        regs[sp - 1] = this.execInstanceof(fcode, regs[sp - 1] as Value, rhs, pc)
        return pc + 1
      }
      case Op.NEW_OBJECT:
        regs[sp++] = new Obj(this.ctx.builtins.Object)
        frame.sp = sp
        return pc + 1
      case Op.NEW_ARRAY:
        frame.sp = this.execNewArray(regs, bx, sp)
        return pc + 1
      case Op.ARRAY_APPEND:
        frame.sp = this.execArrayAppend(regs, a, sp)
        return pc + 1
      case Op.DEFINE_FIELD:
        frame.sp = this.execDefineField(regs, consts, a, bx, sp)
        return pc + 1
      case Op.COPY_DATA_PROPS:
        frame.sp = --sp
        this.execCopyDataProps(fcode, regs[sp - 1] as Obj, regs[sp] as Value, pc)
        return pc + 1
      case Op.COPY_REST:
        frame.sp = this.execCopyRest(fcode, regs, bx, pc, sp)
        return pc + 1
      case Op.TEMPLATE:
        regs[sp++] = this.getTemplateObject(fcode, consts[bx] as TemplateSite)
        frame.sp = sp
        return pc + 1
      case Op.REGEXP:
        regs[sp] = this.execRegExp(fcode, consts[bx] as RegExpSite, pc)
        frame.sp = sp + 1
        return pc + 1
      case Op.ADD:
      case Op.SUB:
      case Op.MUL:
      case Op.LT:
      case Op.LE:
      case Op.GT:
      case Op.GE: {
        const b = regs[--sp] as Value
        const lhs = regs[sp - 1] as Value
        frame.sp = sp
        const sym =
          op === Op.ADD
            ? "+"
            : op === Op.SUB
              ? "-"
              : op === Op.MUL
                ? "*"
                : op === Op.LT
                  ? "<"
                  : op === Op.LE
                    ? "<="
                    : op === Op.GT
                      ? ">"
                      : ">="
        if (this.execBinarySlow(frame, sym, lhs, b, pc, sp)) return -1
        return pc + 1
      }
      case Op.SEQ: {
        const b = regs[--sp]
        frame.sp = sp
        regs[sp - 1] = regs[sp - 1] === b
        return pc + 1
      }
      case Op.SNE: {
        const b = regs[--sp]
        frame.sp = sp
        regs[sp - 1] = regs[sp - 1] !== b
        return pc + 1
      }
      case Op.BINOP: {
        const b = regs[--sp] as Value
        const lhs = regs[sp - 1] as Value
        frame.sp = sp
        if (typeof lhs === "number" && typeof b === "number") {
          regs[sp - 1] = this.execBinopNum(a, lhs, b)
          return pc + 1
        }
        if (this.execBinopSlow(frame, a, lhs, b, pc, sp)) return -1
        return pc + 1
      }
      case Op.UNARY: {
        const v = regs[sp - 1] as Value
        if (typeof v === "number" && a < 3) {
          regs[sp - 1] = a === 0 ? -v : a === 1 ? +v : ~v
          return pc + 1
        }
        if (this.execUnarySlow(frame, a, v, pc, sp)) return -1
        return pc + 1
      }
      case Op.NOT:
        regs[sp - 1] = !regs[sp - 1]
        return pc + 1
      case Op.TO_NUMERIC: {
        const v = regs[sp - 1] as Value
        if (typeof v !== "number" && this.execToNumericSlow(frame, a, v, pc, sp)) return -1
        return pc + 1
      }
      case Op.INC: {
        const v = regs[sp - 1] as Value
        if (typeof v === "number") {
          regs[sp - 1] = a === 0 ? v + 1 : v - 1
          return pc + 1
        }
        if (this.execIncSlow(frame, a, v, pc, sp)) return -1
        return pc + 1
      }
      case Op.TO_STRING: {
        const v = regs[sp - 1] as Value
        if (typeof v !== "string" && this.execToStringSlow(frame, a, v, pc, sp)) return -1
        return pc + 1
      }
      case Op.CONCAT:
        frame.sp = this.execConcat(regs, bx, sp)
        return pc + 1
      case Op.JUMP:
        return bx
      case Op.LOOP:
        frame.pc = bx
        if (--this.fuel <= 0) return -3
        return bx
      case Op.JUMP_IF_FALSE:
        frame.sp = sp - 1
        return regs[sp - 1] ? pc + 1 : bx
      case Op.JUMP_IF_TRUE:
        frame.sp = sp - 1
        return regs[sp - 1] ? bx : pc + 1
      case Op.JUMP_COND: {
        const v = regs[sp - 1]
        if (a === CondKind.NULLISH) {
          if (v === null || v === undefined) {
            regs[sp - 1] = undefined
            return bx
          }
          return pc + 1
        }
        if (a === CondKind.NULLISH_METHOD) {
          if (v === null || v === undefined) {
            frame.sp = sp - 1
            regs[sp - 2] = undefined
            return bx
          }
          return pc + 1
        }
        const jump =
          a === CondKind.TRUTHY_KEEP
            ? Boolean(v)
            : a === CondKind.FALSY_KEEP
              ? !v
              : a === CondKind.NOT_NULLISH_KEEP
                ? v !== null && v !== undefined
                : v !== undefined
        if (jump) return bx
        frame.sp = sp - 1
        return pc + 1
      }
      case Op.THROW:
        return this.execThrow(frame, regs[--sp] as Value, pc, sp)
      case Op.THROW_ERROR:
        return this.execThrowError(frame, bx, pc, sp)
      case Op.END_FINALLY:
        return this.execEndFinally(frame, bx, pc, sp)
      case Op.RETURN:
      case Op.END_PROGRAM: {
        const v = regs[sp - 1] as Value
        if (frame.mode === 0) {
          this.frames.pop()
          if (frame.counted) this.depth--
          if (this.pool.length < 128) this.pool.push(frame)
          const caller = this.frames[this.frames.length - 1]!
          caller.regs[caller.sp++] = v
          caller.pc++
          return -1
        }
        return this.execReturnSlow(frame, v, pc, sp) ? -1 : -2
      }
      case Op.NOP:
        return pc + 1
      case Op.CALL: {
        const called = this.execCallSlow(frame, a, pc, sp)
        if (called === 1) return this.fuel <= 0 ? -3 : -1
        if (called === 2) return -4
        frame.pc = pc + 1
        return this.fuel <= 0 ? -3 : pc + 1
      }
      case Op.CALL_SPREAD: {
        const called = this.execCallSpread(frame, pc, sp)
        if (called === 1) return this.fuel <= 0 ? -3 : -1
        if (called === 2) return -4
        frame.pc = pc + 1
        return this.fuel <= 0 ? -3 : pc + 1
      }
      case Op.NEW:
        if (this.execNew(frame, a, pc, sp)) return -1
        return pc + 1
      case Op.NEW_SPREAD:
        if (this.execNewSpread(frame, pc, sp)) return -1
        return pc + 1
      case Op.ITER_OPEN:
        return this.execIterOpen(frame, a, pc, sp)
      case Op.ITER_INIT:
        this.execIterInit(frame, a, pc, sp)
        return pc + 1
      case Op.ITER_STEP: {
        const rec = regs[a]
        if (rec instanceof Position) {
          const step = rec.step()
          if (!step.done) {
            regs[sp++] = step.value
            frame.sp = sp
            return skipJump(fcode.code, pc)
          }
          return bx
        }
        if (this.execIterStepSlow(frame, rec as CustomIter, bx, pc, sp)) return -1
        return frame.pc
      }
      case Op.ITER_RESULT:
        return this.execIterResult(frame, a, bx, pc, sp)
      case Op.ITER_CLOSE:
        return this.execIterClose(frame, a, bx, pc, sp)
      case Op.ITER_APPEND_ALL:
        return this.execIterAppendAll(frame, a, bx, pc, sp)
      case Op.FOR_IN:
        regs[sp - 1] = this.execForIn(fcode, regs[sp - 1] as Value, pc)
        return pc + 1
      case Op.GENERATOR_START:
        execGeneratorStart(this, frame, pc, sp)
        return -1
      case Op.YIELD:
        if (execYield(this, frame, pc, sp)) return -1
        return frame.pc
      case Op.RESUME:
        return execResume(frame, bx, pc, sp)
      case Op.AWAIT:
        execAwait(this, frame, a, pc, sp)
        return -1
      case Op.YSTAR:
        return execYstar(frame, a, bx, pc, sp)
      case Op.YSTAR_RESULT:
        return execYstarResult(frame, a, bx, pc, sp)
      default:
        throw new Error(`Unexpected wide op ${op}`)
    }
  }
}

// Skips the `JUMP slow` instruction following a test-and-skip `ITER_OPEN` or `ITER_STEP`.
const skipJump = (code: Int32Array, pc: number): number => ((code[pc + 1]! & 0xff) === Op.EXTRA ? pc + 3 : pc + 2)

// A member read's result replaces its base at `at`; a method read (mode 1) keeps the receiver under the value.
const writeRead = (regs: Array<unknown>, at: number, mode: number, receiver: Value, value: Value): number => {
  if (mode !== 1) {
    regs[at] = value
    return at + 1
  }
  regs[at] = receiver
  regs[at + 1] = value
  return at + 2
}

const NEXT: GeneratorRequest = { kind: "next", value: undefined }

// Where the call at `pc` is located: its own node, or inside the VM's internal code, the call that entered it.
const callSiteOf = (frame: Frame, pc: number) =>
  (frame.code.flags & CodeFlags.INTERNAL) === 0 ? frame.code.siteAt(pc) : frame.origin

// Rewrites an array's first item in place, so arrays a native returns share the item shape JSC sees in the VM's own.
const normalizeItems = (value: unknown) => {
  if (!(value instanceof Arr) || !(0 in value.items)) return
  const first = value.items[0]
  value.items[0] = ""
  value.items[0] = first
}

let warmed = false

const WARMUP_SOURCE = [
  "return (async () => {",
  "  let totalSum = 0",
  "  const fib = (n) => (n < 2 ? n : fib(n - 1) + fib(n - 2))",
  "  const restFn = (a, b, ...r) => r.length",
  "  const fiveFn = (a, b, c, d, e) => (a === b ? c : d) !== e ? 1 : 0",
  "  const work = async (i) => { await null; return i * 2 }",
  "  function* range(n) { for (let i = 0; i < n; i++) yield i }",
  "  for (let r = 0; r < 12; r++) {",
  "    let sum = 0",
  "    for (let i = 0; i < 6; i++) sum = (sum + i * 3 + (i === 2 ? 1 : 0)) % 1000003",
  "    sum += fib(3) + restFn(1, 2, 3) + fiveFn(r & 1, 1, 2, work, fib)",
  "    for (const x of range(3)) sum += x",
  '    let out = ""',
  "    for (let i = 0; i < 3; i++) out += String.fromCharCode(97 + (i % 26))",
  "    const parts = []",
  "    for (let i = 0; i < 3; i++) parts.push(`item-${i}`)",
  "    const map = new Map(), set = new Set()",
  '    for (let i = 0; i < 4; i++) { map.set("k" + (i % 2), i); set.add(i % 2) }',
  "    for (const [k, v] of map) sum += v",
  "    for (const v of set) sum += v",
  '    map.delete("k0"); set.delete(0)',
  "    const items = Array.from({ length: 4 }, (_, i) => (i * 7919) % 4)",
  "    const mapped = items.map((x) => x * 2).filter((x) => x % 3 !== 0)",
  "    const total = mapped.reduce((a, b) => a + b, 0)",
  "    const sorted = mapped.slice(0, 4).sort((a, b) => a - b)",
  '    const obj = { a: 1, b: "two", c: [1, r], d: null, e: sorted }',
  "    if (r >= 2) sum += JSON.stringify(JSON.parse(JSON.stringify(obj))).length",
  "    const pres = await Promise.all(Array.from({ length: 2 }, (_, i) => work(i)))",
  "    const tres = await Promise.all(Array.from({ length: 2 }, (_, i) => tools.echo({ id: i })))",
  '    totalSum += sum + total + sorted.length + pres.length + tres.length + out.length + parts.join(",").length + map.size + set.size',
  "  }",
  "  return totalSum",
  "})()",
].join("\n")

const warmupVm = (vm: Vm): void => {
  warmed = true
  const savedTripEvery = vm.tripEvery
  vm.tripEvery = 0
  try {
    const ast = parse(WARMUP_SOURCE, {
      ecmaVersion: "latest",
      sourceType: "script",
      allowReturnOutsideFunction: true,
    })
    const source = new Source("<warmup>", WARMUP_SOURCE, ast)
    vm.start(source)
    for (;;) {
      const stop = vm.run()
      if (stop.kind === "done" || stop.kind === "stuck") break
      if (stop.kind === "host") {
        for (const call of stop.calls) vm.complete(call.id, normal(1))
      }
    }
    vm.sourceCodes.delete(source.id)
    vm.ctx.sources.delete(source.id)
  } catch {
  } finally {
    vm.frames.length = 0
    vm.templates.clear()
    vm.scheduler.parked.clear()
    vm.scheduler.queue.length = 0
    vm.scheduler.head = 0
    vm.scheduler.pending = 0
    vm.scheduler.nextID = 0
    vm.scheduler.unhandled.clear()
    vm.hosts.queued.length = 0
    vm.hosts.running.clear()
    vm.hosts.inbox.length = 0
    vm.hosts.nextID = 0
    vm.hosts.blocked = undefined
    vm.hosts.input = undefined
    vm.depth = 0
    vm.fuel = INITIAL_FUEL
    vm.sliced = false
    vm.outcome = undefined
    vm.tripEvery = savedTripEvery
  }
}
