import type { Diagnostic } from "../codemode.js"
import { fromJson, type Json } from "./data.js"
import { startExtensionCall } from "./runtime/extensions.js"
import type { Interpreter } from "./runtime/interpreter.js"
import { type AstNode, Lost, lostError } from "./runtime/model.js"
import { Arr, PromiseObj, type Value } from "./runtime/objects.js"
import { promiseLike } from "./runtime/promises.js"
import type { Completion } from "./runtime/signals.js"
import { type ExtensionRequest, HostCall, type HostRequest, Resolving } from "./scheduler.js"
import type { ExtensionInvocation } from "../tool-runtime.js"
import type { Code } from "./code.js"
import { internalCode, tryFastBoundaryOrJson, VmIntrinsic } from "./internal-prelude.js"
import { type FrameMode, Mode, type Vm } from "./vm.js"

// The VM's side of host work (plan §4.10): tool calls, `search`, and extension calls, the host calls they queue, and
// the blocking call a job may wait on.

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

export type HostResult = Value | typeof BLOCK | typeof ENTERED

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

type Delivery = { readonly call: HostCall; readonly completion: Completion }

/** Visited nodes a native fast path may spend before it hands the work to the prelude walk, which slices. */
export const VISIT_BUDGET = 2048

/**
 * The host calls of one run: queued (written ahead, for the driver to start at the next stop), running, completed and
 * waiting in the inbox, and the blocking call the current job waits on. Ids count up in program order.
 */
export class HostCalls {
  queued: Array<HostCall> = []
  readonly running = new Map<number, HostCall>()
  readonly inbox: Array<Delivery> = []
  nextID = 0
  /** The blocking call the job on the stack waits on. */
  blocked: HostCall | undefined = undefined
  /** A completed blocking call's outcome, which continues the job on the stack before anything else runs. */
  input: { readonly call: HostCall; readonly completion: Completion } | undefined = undefined
  /** The synchronous extension call the program is in the middle of: see `Engine.activeExtension`. */
  extension: { readonly path: string } | undefined = undefined
  extensionResume: ((completion: Completion) => HostResult) | undefined = undefined

  constructor(
    private readonly ctx: Interpreter<unknown>,
    readonly promises: Promises,
  ) {}

  /** Queues concurrent host work; `resolving` settles its promise in a later job, in completion order. */
  host(
    request: HostRequest,
    call: {
      readonly label: string
      readonly result: "json" | "value"
      readonly resolving: Resolving
      readonly site: AstNode | undefined
    },
  ): HostCall {
    return this.queue(request, call.label, false, call.result, call.resolving, call.site)
  }

  /** Queues blocking `search` work: the job stops until it completes, then continues with its result. */
  blockSearch(args: Array<Json | undefined>): typeof BLOCK {
    return this.block({ kind: "search", args }, "search", undefined)
  }

  /** Queues blocking extension work: the job stops until it completes, then continues with `resume`. */
  blockExtension(call: ExtensionRequest, resume: (completion: Completion) => HostResult): typeof BLOCK {
    return this.block({ kind: "extension", call }, "extension", resume)
  }

  private block(
    request: HostRequest,
    label: string,
    resume: ((completion: Completion) => HostResult) | undefined,
  ): typeof BLOCK {
    this.blocked = this.queue(request, label, true, "value", undefined, undefined)
    this.extensionResume = resume
    return BLOCK
  }

  private queue(
    request: HostRequest,
    label: string,
    blocking: boolean,
    result: "json" | "value",
    resolving: Resolving | undefined,
    site: AstNode | undefined,
  ): HostCall {
    const id = this.nextID++
    const call = new HostCall(id, request, label, blocking, result, resolving, site)
    this.queued.push(call)
    return call
  }

  /** Continues the job stopped at a blocking call with its outcome. */
  resume(input: { readonly call: HostCall; readonly completion: Completion }): HostResult {
    const resume = this.extensionResume
    if (resume !== undefined) {
      this.extensionResume = undefined
      return resume(input.completion)
    }
    if (!input.completion.ok) throw input.completion.error
    return promiseLike(this.ctx, fromJson(this.ctx, input.completion.value as Json | undefined))
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
    const request = call.request
    if (request.kind === "extension") {
      request.call.invocation = undefined
      request.call.host = undefined
      request.call.args = []
    }
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
    if (!completion.ok) resolving.reject(completion.error)
    else {
      resolving.resolve(
        call.result === "json" ? fromJson(this.ctx, completion.value as Json | undefined) : (completion.value as Value),
      )
    }
    return true
  }
}

// --- Tool calls ---

/**
 * A tool call returns its promise at once. Plain-data arguments cross on the native fast path; anything else
 * (`toJSON`, a promise, a deep or shared value) crosses through `$vmCross` at the call, which queues the call with the
 * same `Resolving` or rejects it. Either way the call is queued once its arguments have crossed, and the driver starts
 * it before any other job runs.
 */
export const callTool = (
  vm: HostVm,
  hosts: HostCalls,
  path: ReadonlyArray<string>,
  args: Array<Value>,
  site: AstNode | undefined,
): HostResult => {
  const resolving = hosts.promises.resolving(hosts.promises.newPromise())
  const json = crossFast(vm.ctx, args)
  if (json === undefined) {
    // A failure while crossing rejects the promise, which the caller receives either way.
    vm.pushInternal(
      internalCode("$vmCross"),
      [arrayOf(vm, args), arrayOf(vm, [...path]), resolving],
      site,
      Mode.REJECT_ONLY,
      resolving,
      resolving.promise,
    )
    return ENTERED
  }
  if (json instanceof Failure) {
    resolving.reject(json.error)
    return resolving.promise
  }
  hosts.host({ kind: "tool", path, args: json }, { label: path.join("."), result: "json", resolving, site })
  return resolving.promise
}

/** `search(...)`: blocking; its result can be used directly, or awaited and chained like a Promise. */
export const callSearch = (vm: HostVm, hosts: HostCalls, args: Array<Value>, site: AstNode | undefined): HostResult => {
  const json = crossFast(vm.ctx, args)
  if (json === undefined) {
    vm.pushInternal(internalCode("$vmCross"), [arrayOf(vm, args), "search"], site)
    return ENTERED
  }
  if (json instanceof Failure) throw json.error
  return hosts.blockSearch(json)
}

class Failure {
  constructor(readonly error: unknown) {}
}

// Every argument as host JSON on the budgeted fast path; undefined when one needs the prelude walk.
const crossFast = (ctx: Interpreter<unknown>, args: Array<Value>): Array<Json | undefined> | Failure | undefined => {
  const json: Array<Json | undefined> = []
  try {
    for (const arg of args) {
      const crossed = tryFastBoundaryOrJson(ctx.builtins, arg, true, VISIT_BUDGET)
      if (!crossed.ok) return undefined
      json.push(crossed.json)
    }
  } catch (error) {
    return new Failure(error)
  }
  return json
}

const arrayOf = (vm: HostVm, values: Array<Value>) => new Arr(vm.ctx.builtins.Array, [...values])

// --- Extension calls ---

/**
 * A synchronous extension function's call, staged here so its host values never enter a frame: the `extension.before`
 * hook (blocking), then the host function; what it returns settles now (blocking) unless it is an Effect or a Promise,
 * which the program holds a promise for. The call is active, holding live host values, until its result is a program
 * value or its concurrent call is queued.
 */
export const callExtension = (
  ctx: Interpreter<unknown>,
  hosts: HostCalls,
  slots: ReadonlyArray<unknown>,
  site: AstNode | undefined,
): HostResult => {
  const label = slots[2] as string
  const call = {
    host: slots[0],
    args: slots[1] as ReadonlyArray<unknown>,
    label,
    invocation: slots[3] as ExtensionInvocation | undefined,
  }
  if (call.host instanceof Lost) throw lostError(`The function ${label}`)
  hosts.extension = { path: label }
  const run = (): HostResult => {
    const started = startExtensionCall(ctx, call.host as Function, call.args, call, site)
    if (started instanceof PromiseObj) {
      hosts.extension = undefined
      return started
    }
    return hosts.blockExtension(started, (completion) => {
      hosts.extension = undefined
      if (!completion.ok) throw completion.error
      return completion.value as Value
    })
  }
  if (call.invocation === undefined || ctx.tools.hooks["extension.before"] === undefined) return run()
  const before: ExtensionRequest = { stage: "before", ...call, host: undefined, threw: false }
  return hosts.blockExtension(before, (completion) => {
    if (!completion.ok) {
      hosts.extension = undefined
      throw completion.error
    }
    return run()
  })
}

/** The intrinsics the boundary walk calls to queue a tool or search host call. */
export const registerHostIntrinsics = (map: Map<string, unknown>, vm: Vm): void => {
  const json = (value: Value) => (value as Arr).items as Array<Json | undefined>
  map.set(
    "$HostTool",
    new VmIntrinsic("$HostTool", ([path, args, resolving]) => {
      const keys = (path as Arr).items as Array<string>
      const site = vm.frames[vm.frames.length - 1]?.origin
      vm.hosts.host(
        { kind: "tool", path: keys, args: json(args) },
        { label: keys.join("."), result: "json", resolving: resolving as unknown as Resolving, site },
      )
      return undefined
    }),
  )
  map.set("$HostSearch", new VmIntrinsic("$HostSearch", ([args]) => vm.hosts.blockSearch(json(args)) as never))
}
