import type { Diagnostic } from "../codemode.js"
import { normalizeError, locate } from "./runtime/errors.js"
import { MAX_PENDING_PROMISES } from "./runtime/limits.js"
import { type AstNode, IteratorSymbol, rangeError, typeError } from "./runtime/model.js"
import {
  Arr,
  BoundFn,
  type Callable,
  Fn,
  get,
  iteratorResult,
  Obj,
  Position,
  PromiseObj,
  Resolver,
  type Value,
} from "./runtime/objects.js"
import { builtinCursor, isThenable } from "./runtime/operations.js"
import { adoptThenable, capability, finishCombination, react } from "./runtime/promises.js"
import { describeValue, typeofValue } from "./runtime/references.js"
import { abrupt, type Completion, Interruption, Invoke, MAX_CALL_DEPTH, normal } from "./runtime/signals.js"
import { type Combination, type Job, type Reaction, Resolving } from "./scheduler.js"
import { internalCode, VmIntrinsic } from "./internal-prelude.js"
import { CodeFlags } from "./opcodes.js"
import { type Frame, type FrameMode, Mode, type Vm } from "./vm.js"

export type SettlingTarget = {
  resolve(value: Value): void
  reject(reason: unknown): void
}

/**
 * Target for a `Promise.prototype.finally` cleanup frame running in `Mode.SETTLE`.
 * When the cleanup completes with `result`, chains `finallyCleaned` and `finallyOutcome` reactions.
 */
export class FinallyTarget implements SettlingTarget {
  constructor(
    readonly vm: Vm,
    readonly made: Resolving,
    readonly site: AstNode | undefined,
    readonly outcome: Completion,
  ) {}

  resolve(result: Value): void {
    const after = this.vm.scheduler.promiseResolve(result)
    const derived = capability(this.vm.ctx, this.site)
    this.vm.scheduler.then(after, { kind: "finallyCleaned", target: derived })
    this.vm.scheduler.then(derived.promise, {
      kind: "finallyOutcome",
      target: this.made,
      outcome: this.outcome,
    })
  }

  reject(reason: unknown): void {
    this.made.reject(reason)
  }
}

/**
 * Target for `$vmAsyncFromSyncClose`: regardless of whether `iterator.return()` succeeds or throws,
 * the original rejection reason wins.
 */
export class AsyncFromSyncCloseTarget implements SettlingTarget {
  constructor(
    readonly made: Resolving,
    readonly reason: unknown,
  ) {}

  resolve(_value: Value): void {
    this.made.reject(this.reason)
  }

  reject(_error: unknown): void {
    this.made.reject(this.reason)
  }
}

type Parked = {
  readonly promise: PromiseObj
  readonly node: AstNode | undefined
  readonly result: Value
}

export class VmScheduler {
  intrinsicThen: Callable | undefined
  readonly parked = new Map<Frame, Parked>()
  readonly queue: Array<Job> = []
  head = 0
  pending = 0
  nextID = 0
  readonly unhandled = new Map<PromiseObj, Diagnostic>()

  constructor(readonly vm: Vm) {}

  get hasJobs(): boolean {
    return this.head < this.queue.length
  }

  newPromise(): PromiseObj {
    if (this.pending >= MAX_PENDING_PROMISES) {
      throw rangeError(
        `Too many pending promises (limit ${MAX_PENDING_PROMISES}); await promises before creating more.`,
      )
    }
    this.pending++
    return new PromiseObj(this.vm.ctx.builtins.Promise, this.nextID++)
  }

  resolving(promise: PromiseObj, site?: AstNode): Resolving {
    return new Resolving(this, promise, site)
  }

  then(promise: PromiseObj, reaction: Reaction): void {
    if (promise.state === "pending") {
      promise.reactions.push(reaction)
    } else {
      if (promise.state === "rejected") this.unhandled.delete(promise)
      const settled = promise.state === "fulfilled" ? normal(promise.result) : abrupt(promise.result)
      this.enqueue({ kind: "reaction", reaction, settled })
    }
    promise.handled = true
  }

  detach(promise: PromiseObj, reaction: Reaction): void {
    const index = promise.reactions.indexOf(reaction)
    if (index >= 0) promise.reactions.splice(index, 1)
  }

  promiseResolve(value: Value): PromiseObj {
    if (value instanceof PromiseObj) return value
    const promise = this.newPromise()
    this.resolveWith(promise, value)
    return promise
  }

  reject(promise: PromiseObj, reason: unknown): void {
    this.settle(promise, abrupt(reason))
  }

  resolveWith(promise: PromiseObj, resolution: Value, site?: AstNode): void {
    if (resolution === promise) {
      const cycle = typeError("Chaining cycle detected: a promise cannot resolve with itself.", site)
      this.settle(promise, abrupt(cycle))
      return
    }
    if (!(resolution instanceof Obj)) {
      this.settle(promise, normal(resolution))
      return
    }
    const then = get(resolution, "then")
    if (typeofValue(then) !== "function") {
      this.settle(promise, normal(resolution))
      return
    }
    this.enqueue({ kind: "thenable", promise, thenable: resolution, then })
  }

  settle(promise: PromiseObj, completion: Completion): void {
    if (promise.state !== "pending") return
    this.pending--
    promise.state = completion.ok ? "fulfilled" : "rejected"
    promise.result = completion.ok ? completion.value : completion.error
    const reactions = promise.reactions
    promise.reactions = []
    if (!completion.ok && !promise.handled && !(completion.error instanceof Interruption)) {
      const failure = normalizeError(completion.error)
      this.unhandled.set(promise, {
        ...failure,
        message: `Unhandled rejection from an un-awaited promise: ${failure.message}`,
      })
    }
    for (const reaction of reactions) {
      this.enqueue({ kind: "reaction", reaction, settled: completion })
    }
  }

  enqueue(job: Job): void {
    this.queue.push(job)
  }

  dequeue(): Job | undefined {
    if (this.head === this.queue.length) {
      if (this.head > 0) {
        this.queue.length = 0
        this.head = 0
      }
      return undefined
    }
    const job = this.queue[this.head++]
    if (this.head > 4096 && this.head * 2 > this.queue.length) {
      this.queue.splice(0, this.head)
      this.head = 0
    }
    return job
  }

  compact(): void {
    this.queue.splice(0, this.head)
    this.head = 0
  }

  park(frames: Array<Frame>, promise: PromiseObj, node: AstNode | undefined, result: Value): void {
    this.parked.set(frames[0]!, { promise, node, result })
    this.then(promise, { kind: "await", frames })
  }

  stuckAwait(): AstNode | undefined {
    const results = new Set<Value>()
    for (const parked of this.parked.values()) {
      if (parked.result instanceof PromiseObj) results.add(parked.result)
    }
    const located = [...this.parked.values()].filter((parked) => parked.node !== undefined)
    return (located.find((parked) => !results.has(parked.promise)) ?? located[0])?.node
  }

  diagnostics(): Array<Diagnostic> {
    return [...this.unhandled].sort(([left], [right]) => left.id - right.id).map(([, diagnostic]) => diagnostic)
  }

  beginJob(job: Job): void {
    const vm = this.vm
    if (job.kind === "thenable") {
      const call = adoptThenable(vm.ctx, job.promise, job.thenable, job.then)
      if (call === undefined || call.kind !== "thenable") return
      this.enterSettlingCall(
        undefined,
        call.then,
        call.thenable,
        call.functions,
        Mode.REJECT_ONLY,
        call.resolving,
        undefined,
        undefined,
      )
      return
    }

    const reaction = job.reaction
    if (reaction.kind === "await") {
      const frames = reaction.frames
      this.parked.delete(frames[0]!)
      for (const f of frames) {
        if (f.counted) vm.depth++
        vm.frames.push(f)
      }
      const top = frames[frames.length - 1]!
      if (job.settled.ok) {
        top.regs[top.sp++] = job.settled.value
        return
      }
      top.pc--
      vm.unwind(job.settled.error)
      return
    }

    if (reaction.kind === "asyncFromSync") {
      if (job.settled.ok) {
        reaction.made.resolve(iteratorResult(vm.ctx.builtins.Object, job.settled.value as Value, reaction.done))
        return
      }
      if (
        reaction.done ||
        reaction.close === undefined ||
        job.settled.error instanceof Interruption ||
        reaction.close instanceof Position
      ) {
        reaction.made.reject(job.settled.error)
        return
      }
      vm.pushInternal(
        internalCode("$vmAsyncFromSyncClose"),
        [reaction.close.iterator],
        reaction.site,
        Mode.SETTLE,
        new AsyncFromSyncCloseTarget(reaction.made, job.settled.error),
      )
      return
    }

    const call = react(vm.ctx, reaction, job.settled)
    if (call === undefined) return
    if (call.kind === "handler") {
      this.enterSettlingCall(
        undefined,
        call.handler,
        undefined,
        [call.argument],
        Mode.SETTLE,
        call.derived,
        undefined,
        undefined,
      )
      return
    }
    if (call.kind === "finally") {
      this.enterSettlingCall(
        undefined,
        call.cleanup,
        undefined,
        [],
        Mode.SETTLE,
        new FinallyTarget(vm, call.made, call.site, call.outcome),
        undefined,
        call.site,
      )
    }
  }

  enterSettlingCall(
    callerFrame: Frame | undefined,
    callable: Value,
    thisVal: Value,
    args: Array<Value>,
    mode: FrameMode,
    target: SettlingTarget,
    answer: Value,
    site: AstNode | undefined,
  ): number {
    const vm = this.vm
    while (callable instanceof BoundFn) {
      thisVal = callable.boundThis
      args = [...callable.boundArgs, ...args]
      callable = callable.target
    }

    if (callable instanceof Resolver) {
      try {
        const res = callable.invoke(thisVal, args) as Value
        if (mode === Mode.SETTLE) target.resolve(res)
      } catch (err) {
        target.reject(locate(err, site ?? vm.currentSite()))
      }
      if (answer !== undefined && callerFrame !== undefined) {
        callerFrame.regs[callerFrame.sp++] = answer
      }
      return 0
    }

    if (callable instanceof Fn) {
      const code = callable.code
      if ((code.flags & (CodeFlags.ASYNC | CodeFlags.GENERATOR)) === 0) {
        const counted = (code.flags & CodeFlags.INTERNAL) === 0
        if (counted && vm.depth > MAX_CALL_DEPTH) {
          target.reject(rangeError("Maximum call stack size exceeded", site ?? vm.currentSite()))
          if (answer !== undefined && callerFrame !== undefined) {
            callerFrame.regs[callerFrame.sp++] = answer
          }
          return 0
        }
        vm.pushFn(callable, thisVal, args, site ?? callerFrame?.origin, mode, target, answer)
        return 1
      }
    }

    vm.pushInternal(
      internalCode("$vmSettleCall"),
      [callable, thisVal, new Arr(vm.ctx.builtins.Array, args)],
      site ?? callerFrame?.origin,
      mode,
      target,
      answer,
    )
    return 1
  }

  handlePromisePush(
    callerFrame: Frame,
    kindName: string,
    slots: Array<unknown>,
    site: AstNode | undefined,
  ): number | undefined {
    // An executor's result is ignored and only its failure rejects; `Promise.try` settles with its callback's outcome.
    if (kindName === "Promise executor" || kindName === "Promise.try") {
      const made = slots[0] as Resolving
      const mode = kindName === "Promise.try" ? Mode.SETTLE : Mode.REJECT_ONLY
      return this.enterSettlingCall(
        callerFrame,
        slots[1] as Value,
        undefined,
        slots[2] as Array<Value>,
        mode,
        made,
        made.promise,
        site,
      )
    }
    if (kindName === "Promise combinator") {
      const made = slots[0] as Resolving
      this.vm.pushInternal(
        internalCode("$vmCombine"),
        [slots[1], slots[2]],
        site ?? callerFrame.origin,
        Mode.REJECT_ONLY,
        made,
        made.promise,
      )
      return 1
    }
    return undefined
  }
}

export const registerAsyncIntrinsics = (map: Map<string, unknown>, vm: Vm): void => {
  const ctx = vm.ctx
  const builtins = ctx.builtins
  const add = (name: string, fn: (args: Array<Value>) => Value | Invoke) => {
    map.set(name, new VmIntrinsic(name, fn))
  }

  add("$Apply", ([callable, thisVal, args]) => {
    const argItems = args instanceof Arr ? [...args.items] : []
    return new Invoke(callable, thisVal, argItems, vm.currentSite())
  })

  add("$CombineStart", ([nameVal, items]) => {
    const name = nameVal as Combination["name"]
    const isIter =
      builtinCursor(builtins, items) !== undefined ||
      (items instanceof Obj && get(items, IteratorSymbol) !== undefined && get(items, IteratorSymbol) !== null)
    if (!isIter) {
      throw typeError(`Promise.${name} expects a synchronous iterable, received ${describeValue(items)}.`)
    }
    const top = vm.frames[vm.frames.length - 1]!
    const made = top.target as Resolving
    const comb: Combination = { name, made, values: [], reasons: [], remaining: 1, attached: [] }
    return comb as unknown as Value
  })

  add("$CombineAdd", ([combVal, item]) => {
    const c = combVal as unknown as Combination
    const p = vm.scheduler.promiseResolve(item)
    const reaction: Reaction = { kind: "combinator", combination: c, index: c.values.length, called: false }
    c.values.push(undefined)
    c.reasons.push(undefined)
    c.remaining++
    c.attached.push([p, reaction])
    vm.scheduler.then(p, reaction)
    return undefined
  })

  add("$CombineEnd", ([combVal]) => {
    const c = combVal as unknown as Combination
    if (c.name === "race" && c.attached.length === 0) {
      throw typeError("Promise.race([]) would never settle; provide at least one promise or value.")
    }
    finishCombination(ctx, c)
    return undefined
  })

  add("$IsThenable", ([val]) => isThenable(val))
}
