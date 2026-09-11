import { Effect } from "effect"
import { type AstNode, InterpreterRuntimeError } from "./model.js"

export type HostCall<R> = (args: Array<unknown>, node: AstNode) => Effect.Effect<unknown, unknown, R>

type HostMember = (key: PropertyKey, node: AstNode) => unknown

type HostFunctionOptions<R> = {
  readonly name: string
  readonly call: HostCall<R>
  /** `new name(...)`; without it `new` is unsupported syntax. */
  readonly construct?: HostCall<R>
  /** Static members read through `name.key`; unknown keys read as `undefined` unless the function decides otherwise. */
  readonly members?: Record<string, unknown> | HostMember
  /** `value instanceof name`; without it the operator rejects this right-hand side. */
  readonly instanceOf?: (value: unknown) => boolean
  /** Whether callback sites (array methods, replacers, promise reactions) admit this function. Defaults to true. */
  readonly callback?: boolean
}

/** A host-implemented function value. `typeof` is "function". */
export class HostFunction<R = never> {
  readonly name: string
  readonly call: HostCall<R>
  readonly construct: HostCall<R> | undefined
  readonly member: HostMember
  readonly instanceOf: ((value: unknown) => boolean) | undefined
  readonly callback: boolean

  constructor(options: HostFunctionOptions<R>) {
    this.name = options.name
    this.call = options.call
    this.construct = options.construct
    this.member = memberLookup(options.members)
    this.instanceOf = options.instanceOf
    this.callback = options.callback ?? true
  }
}

/** A host-implemented object of static members. `typeof` is "object" and it is not callable. */
export class HostNamespace {
  readonly member: HostMember

  constructor(
    readonly name: string,
    members: Record<string, unknown> | HostMember,
  ) {
    this.member = memberLookup(members)
  }
}

const memberLookup = (members: Record<string, unknown> | HostMember | undefined): HostMember => {
  if (members === undefined) return () => undefined
  if (typeof members === "function") return members
  const table = new Map(Object.entries(members))
  return (key) => (typeof key === "string" ? table.get(key) : undefined)
}

export type SyncOptions = Omit<HostFunctionOptions<never>, "name" | "call">

type SyncImpl = (args: Array<unknown>, node: AstNode) => unknown

/** Lifts a synchronous implementation, which may throw `InterpreterRuntimeError`, into a host call. */
export const syncCall =
  (impl: SyncImpl): HostCall<never> =>
  (args, node) =>
    Effect.sync(() => impl(args, node))

/** A synchronous host function. */
export const sync = (name: string, impl: SyncImpl, options: SyncOptions = {}): HostFunction<never> =>
  new HostFunction({ name, call: syncCall(impl), ...options })

/** The `call` of a constructor that JS requires to be invoked with `new`. */
export const requiresNew =
  (name: string): HostCall<never> =>
  (_, node) =>
    Effect.sync(() => {
      throw new InterpreterRuntimeError(`Constructor ${name} requires 'new'.`, node)
    })
