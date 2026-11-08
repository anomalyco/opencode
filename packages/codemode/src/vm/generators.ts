import { type AstNode, type GeneratorRequestKind, Throw, typeError } from "./runtime/model.js"
import {
  type Cursor,
  type CustomIterator,
  GeneratorObj,
  get,
  iteratorResult,
  Obj,
  Opaque,
  Position,
  type PromiseObj,
  type Value,
} from "./runtime/objects.js"
import { readProperty, requireIteratorMethod, requireIteratorObject } from "./runtime/operations.js"
import { capability } from "./runtime/promises.js"
import { abrupt, type Completion, type GeneratorRequest, Interruption, normal, Resume } from "./runtime/signals.js"
import type { Reaction, Resolving } from "./scheduler.js"
import { internalCode, VmIntrinsic } from "./internal-prelude.js"
import { CodeFlags, Op } from "./opcodes.js"
import { CustomIter, type Frame, Mode, type Vm } from "./vm.js"

/**
 * CreateAsyncFromSyncIterator's object: an async iterator over a synchronous one, for `for await` and an async
 * generator's `yield*`. Its methods are the `%AsyncFromSyncIterator%` intrinsics, so it is plain data.
 */
export class AsyncFromSyncIterator extends Opaque {
  override readonly tag = "AsyncFromSyncIterator"
  constructor(
    proto: Obj,
    /** The synchronous iterator it drives. */
    readonly sync: Cursor,
    /** Where it was made, so a failure that rejects one of its promises is located there. */
    readonly site: AstNode,
  ) {
    super(proto)
  }
  override get describe() {
    return "an iterator"
  }
}

const result = (vm: Vm, value: Value, done: boolean) => iteratorResult(vm.ctx.builtins.Object, value, done)

// A request reaches a resumed body as a number on its stack (see `RESUME`): its index here.
const REQUEST_KINDS: ReadonlyArray<GeneratorRequestKind> = ["next", "throw", "return"]

const NO_THROW_METHOD = "The delegated iterator does not provide a throw() method."

// Hands a resumed body its request: the value, then the kind's number.
const pushRequest = (frame: Frame, request: GeneratorRequest) => {
  frame.regs[frame.sp++] = request.value
  frame.regs[frame.sp++] = request.kind === "next" ? 0 : request.kind === "throw" ? 1 : 2
}

// Takes the generator's body off the job stack, to continue after the instruction at `pc`.
const suspend = (vm: Vm, generator: GeneratorObj, frame: Frame, pc: number, sp: number) => {
  generator.frame = frame
  frame.pc = pc + 1
  frame.sp = sp
  vm.frames.pop()
  if (frame.counted) vm.depth--
}

// A synchronous generator's step answers the caller now on the stack: a `for...of` waiting at `ITER_STEP` takes the
// value or leaves the loop; any other caller receives an iterator result.
const answerCallerWide = (
  caller: Frame,
  code: Int32Array,
  pc: number,
  prevW: number,
  w: number,
  value: Value,
  done: boolean,
) => {
  if (done) {
    caller.pc = ((prevW >>> 16) << 16) | (w >>> 16)
    return
  }
  const prev2W = pc > 1 ? code[pc - 2]! : 0
  const slot =
    (prev2W & 0xff) === Op.EXTRA
      ? ((prev2W >>> 16) << 16) | (prevW & 0xff00) | ((w >>> 8) & 0xff)
      : (prevW & 0xff00) | ((w >>> 8) & 0xff)
  ;(caller.regs[slot] as CustomIter).done = false
  caller.regs[caller.sp++] = value
  caller.pc = pc + ((code[pc + 1]! & 0xff) === Op.EXTRA ? 3 : 2)
}

const answerCaller = (vm: Vm, value: Value, done: boolean) => {
  const caller = vm.frames[vm.frames.length - 1]!
  const pc = caller.pc
  const code = caller.code.code
  const w = code[pc]!
  if ((w & 0xff) !== Op.ITER_STEP) {
    caller.regs[caller.sp++] = result(vm, value, done)
    caller.pc = pc + 1
    return
  }
  const prevW = pc > 0 ? code[pc - 1]! : 0
  if ((prevW & 0xff) === Op.EXTRA) return answerCallerWide(caller, code, pc, prevW, w, value, done)
  if (done) {
    caller.pc = w >>> 16
    return
  }
  ;(caller.regs[(w >>> 8) & 0xff] as CustomIter).done = false
  caller.regs[caller.sp++] = value
  caller.pc = pc + 2
}

/** Generator.prototype.next/return/throw: the body runs on the caller's job stack until it yields, returns, or throws. */
export const generatorStep = (
  vm: Vm,
  generator: GeneratorObj,
  kind: GeneratorRequestKind,
  value: Value,
): Value | Resume => {
  if (generator.state === "executing") {
    throw typeError(
      generator.proto === vm.ctx.builtins.IteratorHelper
        ? "Iterator helper is already running."
        : "Generator is already running.",
    )
  }
  if (generator.state === "suspendedStart" && kind !== "next") generator.state = "completed"
  if (generator.state === "completed") {
    if (kind === "throw") throw new Throw(value)
    return result(vm, kind === "return" ? value : undefined, true)
  }
  generator.state = "executing"
  return new Resume(generator, { kind, value })
}

/**
 * AsyncGenerator.prototype.next/return/throw: queue the request with its promise, and run the body now if it is
 * waiting for one. A request that arrives while the body runs is answered when the body reaches it.
 */
export const generatorRequest = (
  vm: Vm,
  thisValue: Value,
  kind: GeneratorRequestKind,
  value: Value,
): Value | Resume => {
  const resolving = vm.scheduler.resolving(vm.scheduler.newPromise())
  const promise = resolving.promise
  if (!(thisValue instanceof GeneratorObj) || !thisValue.asynchronous) {
    resolving.reject(typeError(`AsyncGenerator.prototype.${kind} called on incompatible receiver.`))
    return promise
  }
  const generator = thisValue
  const state = generator.state
  if (kind === "next" && state === "completed") {
    resolving.resolve(result(vm, undefined, true))
    return promise
  }
  if (kind === "throw") {
    if (state === "suspendedStart") generator.state = "completed"
    if (generator.state === "completed") {
      resolving.reject(new Throw(value))
      return promise
    }
  }
  const queued = { kind, value }
  generator.queue.push({ request: queued, resolving })
  if (kind === "return" && (state === "suspendedStart" || state === "completed")) {
    generator.state = "awaiting-return"
    awaitReturn(vm, generator)
    return promise
  }
  if (state !== "suspendedStart" && state !== "suspendedYield") return promise
  generator.state = "executing"
  return new Resume(generator, queued)
}

// AsyncGeneratorCompleteStep: answer the oldest request.
const completeStep = (vm: Vm, generator: GeneratorObj, completion: Completion, done: boolean) => {
  const next = generator.queue.shift()!
  if (completion.ok) next.resolving.resolve(result(vm, completion.value as Value, done))
  else next.resolving.reject(completion.error)
}

// AsyncGeneratorDrainQueue: once the body has ended, answer the remaining requests in order.
const drainQueue = (vm: Vm, generator: GeneratorObj) => {
  generator.state = "draining"
  while (true) {
    const next = generator.queue[0]
    if (next === undefined) {
      generator.state = "completed"
      return
    }
    if (next.request.kind === "return") {
      generator.state = "awaiting-return"
      return awaitReturn(vm, generator)
    }
    completeStep(
      vm,
      generator,
      next.request.kind === "throw" ? abrupt(new Throw(next.request.value)) : normal(undefined),
      true,
    )
  }
}

// AsyncGeneratorAwaitReturn: a `return(value)` on an ended or unstarted generator settles once `value` does.
const awaitReturn = (vm: Vm, generator: GeneratorObj) => {
  try {
    vm.scheduler.then(vm.scheduler.promiseResolve(generator.queue[0]!.request.value), {
      kind: "awaitReturn",
      generator,
    })
  } catch (error) {
    finishAwaitReturn(vm, generator, abrupt(error))
  }
}

/** The `awaitReturn` reaction: answers the `return` request with how its value settled, then drains the queue. */
export const finishAwaitReturn = (vm: Vm, generator: GeneratorObj, completion: Completion) => {
  completeStep(vm, generator, completion, true)
  drainQueue(vm, generator)
}

export const execGeneratorStart = (vm: Vm, frame: Frame, pc: number, sp: number): void => {
  const fn = frame.fn!
  const isAsync = (frame.code.flags & CodeFlags.ASYNC) !== 0
  const proto = get(fn, "prototype")
  const builtins = vm.ctx.builtins
  const gen = new GeneratorObj(
    proto instanceof Obj ? proto : isAsync ? builtins.AsyncGenerator : builtins.Generator,
    isAsync,
  )
  gen.state = "suspendedStart"
  frame.mode = Mode.GENERATOR
  frame.target = gen
  suspend(vm, gen, frame, pc, sp)
  const caller = vm.frames[vm.frames.length - 1]!
  caller.regs[caller.sp++] = gen
  caller.pc++
}

export const execYield = (vm: Vm, frame: Frame, pc: number, sp: number): boolean => {
  const v = frame.regs[--sp] as Value
  const gen = frame.target as GeneratorObj
  if (!gen.asynchronous) {
    gen.state = "suspendedYield"
    suspend(vm, gen, frame, pc, sp)
    answerCaller(vm, v, false)
    return true
  }
  completeStep(vm, gen, normal(v), false)
  const next = gen.queue[0]
  if (next !== undefined) {
    frame.sp = sp
    frame.pc = pc + 1
    pushRequest(frame, next.request)
    return false
  }
  gen.state = "suspendedYield"
  suspend(vm, gen, frame, pc, sp)
  vm.deliverAnswer(frame)
  return true
}

export const execResume = (frame: Frame, bx: number, pc: number, sp: number): number => {
  const kind = frame.regs[--sp] as number
  if (kind === 0) {
    frame.sp = sp
    return bx
  }
  if (kind === 1) {
    const errVal = frame.regs[--sp] as Value
    frame.pc = pc
    frame.sp = sp
    throw new Throw(errVal)
  }
  frame.sp = sp
  return pc + 1
}

export const execAwait = (vm: Vm, frame: Frame, a: number, pc: number, sp: number): void => {
  const v = frame.regs[--sp] as Value
  frame.pc = pc
  frame.sp = sp
  const promise = vm.scheduler.promiseResolve(v)
  const site = a === 1 ? undefined : frame.code.siteAt(pc)
  frame.pc = pc + 1
  let bIdx = vm.frames.length - 1
  while (bIdx > 0 && vm.frames[bIdx]!.mode === Mode.CALLER) {
    bIdx--
  }
  const cut = vm.frames.splice(bIdx)
  for (const f of cut) {
    if (f.counted) vm.depth--
  }
  const root = cut[0]!
  const result: Value =
    root.mode === Mode.ASYNC || root.mode === Mode.REJECT_ONLY
      ? (root.target as Resolving).promise
      : root.mode === Mode.GENERATOR
        ? (root.target as GeneratorObj).queue[0]?.resolving.promise
        : undefined
  vm.deliverAnswer(root)
  vm.scheduler.park(cut, promise, site, result)
}

export const execYstar = (frame: Frame, itSlot: number, bx: number, pc: number, sp: number): number => {
  const kind = frame.regs[sp - 1] as number
  const recv = frame.regs[sp - 2] as Value
  const rec = frame.regs[itSlot] as CustomIter
  const site = frame.code.siteAt(pc) ?? frame.origin
  if (kind === 0) {
    frame.regs[sp - 2] = rec.iterator
    frame.regs[sp - 1] = rec.next
    frame.regs[sp] = recv
    frame.sp = sp + 1
    return bx
  }
  const methodName = REQUEST_KINDS[kind]!
  const method = readProperty(rec.iterator, methodName, site)
  if (method === undefined || method === null) {
    frame.sp = sp - 1
    return pc + 1
  }
  const callable = requireIteratorMethod(method, `Iterator ${methodName}`, site)
  frame.regs[sp - 2] = rec.iterator
  frame.regs[sp - 1] = callable
  frame.regs[sp] = recv
  frame.sp = sp + 1
  return bx
}

export const execYstarResult = (frame: Frame, kindSlot: number, bx: number, pc: number, sp: number): number => {
  const res = frame.regs[sp - 1] as Value
  const kind = frame.regs[kindSlot] as number
  const site = frame.code.siteAt(pc) ?? frame.origin
  const obj = requireIteratorObject(res, `Iterator ${REQUEST_KINDS[kind]}() result`, site)
  const done = Boolean(readProperty(obj, "done", site))
  const value = readProperty(obj, "value", site)
  frame.regs[sp - 1] = value
  return done ? bx : pc + 1
}

/** Puts a suspended generator's body back on the job stack, handing it `request` unless it has not started yet. */
export const resumeVmGenerator = (vm: Vm, gen: GeneratorObj, request: GeneratorRequest): void => {
  const f = gen.frame!
  gen.frame = undefined
  if (gen.asynchronous) f.answer = gen.queue[0]!.resolving.promise
  if ((f.code.code[f.pc - 1]! & 0xff) !== Op.GENERATOR_START) pushRequest(f, request)
  if (f.counted) vm.depth++
  vm.frames.push(f)
}

export const completeGeneratorReturn = (vm: Vm, frame: Frame, v: Value): void => {
  const gen = frame.target as GeneratorObj
  vm.frames.pop()
  gen.frame = undefined
  if (!gen.asynchronous) {
    gen.state = "completed"
    vm.release(frame)
    answerCaller(vm, v, true)
    return
  }
  vm.deliverAnswer(frame)
  vm.release(frame)
  completeStep(vm, gen, normal(v), true)
  drainQueue(vm, gen)
}

export const unwindGenerator = (vm: Vm, frame: Frame, error: unknown): boolean => {
  const gen = frame.target as GeneratorObj
  gen.frame = undefined
  if (!gen.asynchronous) {
    gen.state = "completed"
    vm.release(frame)
    return false
  }
  vm.deliverAnswer(frame)
  vm.release(frame)
  completeStep(vm, gen, abrupt(error), true)
  drainQueue(vm, gen)
  return true
}

const settleAdapterStep = (
  vm: Vm,
  adapter: AsyncFromSyncIterator,
  value: Value,
  done: boolean,
  closeOnRejection: boolean,
  made: Resolving,
): void => {
  const reaction: Reaction = {
    kind: "asyncFromSync",
    made,
    done,
    close: closeOnRejection ? adapter.sync : undefined,
    site: adapter.site,
  }
  let wrapper: PromiseObj
  try {
    wrapper = vm.scheduler.promiseResolve(value)
  } catch (error) {
    if (!done && closeOnRejection && adapter.sync !== undefined && !(error instanceof Interruption)) {
      vm.scheduler.enqueue({ kind: "reaction", reaction, settled: abrupt(error) })
    } else {
      made.reject(error)
    }
    return
  }
  vm.scheduler.then(wrapper, reaction)
}

export const handleAdapterPush = (vm: Vm, callerFrame: Frame, slots: Array<unknown>): number => {
  const adapter = slots[0] as AsyncFromSyncIterator
  const kind = slots[1] as GeneratorRequestKind
  const args = slots[2] as Array<Value>
  const site = adapter.site
  const made = capability(vm.ctx, site)
  const sync = adapter.sync
  if (sync instanceof Position) {
    if (kind === "next") {
      const step = sync.step()
      settleAdapterStep(vm, adapter, step.value, step.done, true, made)
    } else if (kind === "return") made.resolve(result(vm, args[0], true))
    else made.reject(typeError(NO_THROW_METHOD, site))
    callerFrame.regs[callerFrame.sp++] = made.promise
    return 0
  }
  vm.pushInternal(
    internalCode("$vmAsyncFromSync"),
    [adapter, kind, args.length > 0, args[0]],
    site,
    Mode.REJECT_ONLY,
    made,
    made.promise,
  )
  return 1
}

export const registerGeneratorIntrinsics = (map: Map<string, unknown>, vm: Vm): void => {
  const ctx = vm.ctx
  const builtins = ctx.builtins
  const add = (name: string, fn: (args: Array<Value>) => Value) => {
    map.set(name, new VmIntrinsic(name, fn))
  }
  // The `$vmAsyncFromSync` frame running now settles this.
  const made = () => vm.frames[vm.frames.length - 1]!.target as Resolving

  add("$WrapAsyncFromSync", ([syncVal]) => {
    const site = vm.currentSite()
    const obj = requireIteratorObject(syncVal, "Iterator method result", site)
    const next = requireIteratorMethod(readProperty(obj, "next", site), "Iterator next", site)
    return new AsyncFromSyncIterator(
      builtins.AsyncFromSyncIterator,
      { iterator: obj, next, asynchronous: false },
      site!,
    )
  })

  add("$AfsGetIter", ([adapter]) => ((adapter as AsyncFromSyncIterator).sync as CustomIterator).iterator)

  add("$AfsGetNext", ([adapter]) => ((adapter as AsyncFromSyncIterator).sync as CustomIterator).next)

  add("$AfsGetMethod", ([adapter, iterator, kind]) => {
    const site = (adapter as AsyncFromSyncIterator).site
    const method = readProperty(iterator as Obj, kind as string, site)
    if (method === undefined || method === null) return undefined
    return requireIteratorMethod(method, `Iterator ${kind as string}`, site)
  })

  add("$AfsCheckObj", ([adapter, res, kind]) =>
    requireIteratorObject(res, `Iterator ${kind as string}() result`, (adapter as AsyncFromSyncIterator).site),
  )

  add("$AfsResolveDone", ([value]) => {
    made().resolve(result(vm, value, true))
    return undefined
  })

  add("$AfsRejectNoThrow", ([adapter]) => {
    made().reject(typeError(NO_THROW_METHOD, (adapter as AsyncFromSyncIterator).site))
    return undefined
  })

  add("$AfsSettle", ([adapter, value, done, close]) => {
    settleAdapterStep(vm, adapter as AsyncFromSyncIterator, value, Boolean(done), Boolean(close), made())
    return undefined
  })
}
