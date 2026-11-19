import type { Code } from "./code.js"
import { DurableFn, Fn } from "./host-function.js"
import type { Interpreter } from "./runtime/interpreter.js"
import type { AstNode, Diagnostic } from "./runtime/model.js"
import { internalCode } from "./internal-prelude.js"
import { Arr, type PromiseObj, reads, type Value } from "./runtime/objects.js"
import { promiseLike } from "./runtime/promises.js"
import { type Completion, Prefetch } from "./runtime/signals.js"
import { HostCall, type HostPolicy, Resolving } from "./scheduler.js"
import { type FrameMode, Mode } from "./vm.js"

// The VM's side of host work (plan §4.10): calls to host functions, the host calls they queue, and the blocking call
// a job may wait on.

/** What host calls need from the promise scheduler. */
export type Promises = {
  newPromise(): PromiseObj
  resolving(promise: PromiseObj, site?: AstNode): Resolving
  /** Unhandled rejections, in promise creation order. */
  diagnostics(): Array<Diagnostic>
}

/** A native's answer asking the VM to stop the job until the blocking host call it queued completes. */
export const BLOCK: unique symbol = Symbol("vm.block")
/** A host operation pushed an internal frame that produces its result. */
export const ENTERED: unique symbol = Symbol("vm.entered")

/** A `Prefetch`: the arguments hold program getters to run first, and then the call is made again (`$vmReplay`). */
export type HostResult = Value | typeof BLOCK | typeof ENTERED | Prefetch

/** What the VM gives host operations: its runtime, and a way to run an internal prelude function at the call. */
export type HostVm = {
  readonly ctx: Interpreter<unknown>
  /**
   * Runs an internal prelude function at the call `origin`; its result is the call's. In another `mode` than `CALLER`,
   * it settles `target`, and the call's result is `answer`: in `REJECT_ONLY` mode, a failure in it rejects `target`.
   */
  pushInternal(
    code: Code,
    args: ReadonlyArray<unknown>,
    origin: AstNode | undefined,
    mode?: FrameMode,
    target?: unknown,
    answer?: Value,
  ): unknown
}

/** Where a host function is, and how its calls are named and saved. */
export type HostTarget = {
  /** How the program names it in errors: `fetch`, `fs.readFile`, `api.issues.list`. */
  readonly label: string
  /** Where it is among the run's host globals, so a resumed run can find it again; none inside a result. */
  readonly path: ReadonlyArray<string> | undefined
  /** The host function whose `snapshot` hooks save the values this call returns, by label; see `Host.Snapshot`. */
  readonly owner: string | undefined
}

type Delivery = { readonly call: HostCall; readonly completion: Completion }

/** Visited nodes a native fast path may spend before it hands the work to the prelude walk, which slices. */
export const VISIT_BUDGET = 2048

/**
 * The host calls of one run: queued (written ahead, for the driver to start at the next stop), running, completed and
 * waiting in the inbox, and the blocking call the current job waits on. Ids count up in program order, and every call
 * of a host function takes one, so its key is `<runId>:<id>`.
 */
export class HostCalls {
  /** Names this run's host calls (`<runId>:<callId>`). */
  runId = ""
  queued: Array<HostCall> = []
  readonly running = new Map<number, HostCall>()
  readonly inbox: Array<Delivery> = []
  nextID = 0
  /** The blocking call the job on the stack waits on. */
  blocked: HostCall | undefined = undefined
  /** A completed blocking call's outcome, which continues the job on the stack before anything else runs. */
  input: { readonly call: HostCall; readonly completion: Completion } | undefined = undefined

  constructor(
    private readonly ctx: Interpreter<unknown>,
    readonly promises: Promises,
  ) {}

  /**
   * Calls a host function from the program, which reached it as `callee`. Its arguments cross to the host now. An
   * `async` or durable function's call is queued and the program gets its promise; a failure crossing rejects it. Any
   * other is called now: its value crosses back at once, a Promise it returned is a promise, and an Effect blocks the
   * job until it completes. When the runtime awaits promises in arguments and one hasn't fulfilled, the call waits for
   * them (see `wait`) first.
   */
  call(
    fn: Fn<unknown> | DurableFn<unknown>,
    values: Array<Value>,
    site: AstNode | undefined,
    target: HostTarget,
    callee: Value,
  ): HostResult {
    const hosts = this.ctx.hosts!
    const waiting: Array<PromiseObj> = []
    // The host functions that cross back among the arguments, when the function takes them.
    const back: Array<Function> | undefined = fn instanceof Fn && fn.takesFunctions ? [] : undefined
    // Program getters in the arguments run first, as program code, before anything else happens for the call: no
    // promise, no call id.
    const crossed = this.cross(values, target.label, waiting, back)
    const async = fn instanceof DurableFn || fn.type === "async"
    // An async call reads its getters in a frame that settles its promise, so a getter that throws rejects it.
    if (crossed instanceof Prefetch && async && reads.list === undefined) return this.read(crossed, callee, values, site)
    if (crossed instanceof Prefetch) return crossed
    if (async) {
      const resolving = this.promises.resolving(this.promises.newPromise(), site)
      if (!crossed.ok) {
        resolving.reject(crossed.error)
        return resolving.promise
      }
      if (waiting.length > 0) return this.wait(waiting, callee, values, site, resolving)
      const policy = fn instanceof DurableFn ? "durable" : fn.idempotent ? "idempotent" : "async"
      const call = this.queue(target, policy, crossed.args, false, resolving, site)
      call.fn = fn
      call.holdsFunctions = back !== undefined && back.length > 0
      return resolving.promise
    }
    if (!crossed.ok) throw crossed.error
    const args = crossed.args
    if (waiting.length > 0) return this.wait(waiting, callee, values, site)
    const id = this.nextID++
    const result = hosts.invoke(fn, args, `${this.runId}:${id}`, target.label)
    if (result.kind === "value") {
      const value = hosts.fromHost(result.value, target.label, target.owner)
      return fn.type === "sync-thenable" ? promiseLike(this.ctx, value) : value
    }
    if (result.kind === "pending") return this.pending(target, result.work, site, id)
    const call = new HostCall(id, `${this.runId}:${id}`, target, fn.type, [], true, undefined, site)
    call.work = result.work
    this.queued.push(call)
    this.blocked = call
    return BLOCK
  }

  // Copies the arguments to the host, reading program getters ahead (see `withReads`): a Prefetch while some are
  // still to run, else the copy or why it failed.
  private cross(
    values: Array<Value>,
    label: string,
    waiting: Array<PromiseObj>,
    back: Array<Function> | undefined,
  ):
    | { readonly ok: true; readonly args: ReadonlyArray<unknown> }
    | { readonly ok: false; readonly error: unknown }
    | Prefetch {
    const outer = reads.missing
    reads.missing = undefined
    reads.depth++
    try {
      const args = this.ctx.hosts!.toHost(values, label, waiting, back)
      return reads.missing !== undefined ? new Prefetch(reads.missing) : { ok: true, args }
    } catch (error) {
      return reads.missing !== undefined ? new Prefetch(reads.missing) : { ok: false, error }
    } finally {
      reads.depth--
      reads.missing = outer
    }
  }

  // Waits in the program for the promises, then calls `callee` again with the same arguments, which cross with their
  // values now, and the getter values read so far. A sync function's call waits where it is, as an `await` would; an
  // async one's settles `resolving`.
  private wait(
    promises: Array<PromiseObj>,
    callee: Value,
    values: Array<Value>,
    site: AstNode | undefined,
    resolving?: Resolving,
  ): HostResult {
    const builtins = this.ctx.builtins
    this.ctx.vm.pushInternal(
      internalCode("$vmHostWait"),
      [
        new Arr(builtins.Array, promises),
        callee,
        new Arr(builtins.Array, values),
        reads.list ?? new Arr(builtins.Array, []),
      ],
      site,
      resolving === undefined ? Mode.CALLER : Mode.ASYNC,
      resolving,
      resolving?.promise,
    )
    return ENTERED
  }

  // Runs an async call's program getters, then the call again (`$vmReplay`), in a frame that settles the call's promise.
  private read(prefetch: Prefetch, callee: Value, values: Array<Value>, site: AstNode | undefined): HostResult {
    const builtins = this.ctx.builtins
    const resolving = this.promises.resolving(this.promises.newPromise(), site)
    this.ctx.vm.pushInternal(
      internalCode("$vmReplay"),
      [
        callee,
        undefined,
        new Arr(builtins.Array, values),
        false,
        new Arr(builtins.Array, []),
        new Arr(builtins.Array, []),
        prefetch as unknown as Value,
      ],
      site,
      Mode.ASYNC,
      resolving,
      resolving.promise,
    )
    return ENTERED
  }

  // What a host function left pending (a Promise, or an Effect): the program holds a promise for it.
  private pending(target: HostTarget, work: unknown, site: AstNode | undefined, id = this.nextID++): PromiseObj {
    const resolving = this.promises.resolving(this.promises.newPromise(), site)
    const call = new HostCall(id, `${this.runId}:${id}`, target, "sync", [], false, resolving, site)
    call.work = work
    this.queued.push(call)
    return resolving.promise
  }

  private queue(
    target: HostTarget,
    policy: HostPolicy,
    args: ReadonlyArray<unknown>,
    blocking: boolean,
    resolving: Resolving | undefined,
    site: AstNode | undefined,
  ): HostCall {
    const id = this.nextID++
    const call = new HostCall(id, `${this.runId}:${id}`, target, policy, args, blocking, resolving, site)
    this.queued.push(call)
    return call
  }

  /** Continues the job stopped at a blocking call with its outcome. */
  resume(input: { readonly call: HostCall; readonly completion: Completion }): HostResult {
    const call = input.call
    const completion = input.completion
    const hosts = this.ctx.hosts!
    if (!completion.ok) throw hosts.failure(completion.error, call.label)
    if (hosts.isPending(completion.value)) return this.pending(call, completion.value, call.site)
    const value = hosts.fromHost(completion.value, call.label, call.owner)
    return call.policy === "sync-thenable" ? promiseLike(this.ctx, value) : value
  }

  /** Hands the queued calls to the driver: they are running from now on. */
  handOver(): Array<HostCall> {
    const calls = this.queued
    this.queued = []
    for (const call of calls) this.running.set(call.id, call)
    return calls
  }

  complete(id: number, completion: Completion): void {
    const call = this.running.get(id)
    if (call === undefined) return
    this.running.delete(id)
    // Its outcome is all that is left: the host function, its arguments, and what it returned are dropped.
    call.data = undefined
    call.fn = undefined
    call.work = undefined
    call.args = []
    if (call.blocking) {
      call.status = "completed"
      if (this.blocked !== call) return
      this.blocked = undefined
      this.input = { call, completion }
      return
    }
    this.inbox.push({ call, completion })
  }

  /** Settles the oldest completed concurrent call's promise; false when the inbox is empty. */
  deliver(): boolean {
    const delivery = this.inbox.shift()
    if (delivery === undefined) return false
    const call = delivery.call
    const completion = delivery.completion
    call.status = "completed"
    const resolving = call.resolving!
    const hosts = this.ctx.hosts!
    if (!completion.ok) {
      resolving.reject(hosts.failure(completion.error, call.label))
      return true
    }
    let value: Value
    try {
      value = hosts.fromHost(completion.value, call.label, call.owner)
    } catch (error) {
      resolving.reject(error)
      return true
    }
    resolving.resolve(value)
    return true
  }
}
