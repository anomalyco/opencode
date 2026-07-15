export * as PermissionModule from "./module"

import { Context, Effect, Layer, Schema } from "effect"
import { PermissionModule as PermissionModuleSchema } from "@opencode-ai/schema/permission-module"

export type Decision = PermissionModuleSchema.Decision

export interface DecideInput {
  moduleID: string
  permission: string
  patterns: readonly string[]
  metadata: Record<string, unknown>
}

export type DecideFn = (input: DecideInput) => Effect.Effect<Decision>

export class RegistrationError extends Schema.TaggedErrorClass<RegistrationError>()(
  "PermissionModule.RegistrationError",
  {
    id: Schema.String,
    reason: Schema.String,
  },
) {}

export interface RegisterInput {
  readonly id: string
  readonly decide: DecideFn
}

export interface Interface {
  readonly register: (input: RegisterInput) => Effect.Effect<void, RegistrationError>
  readonly registerSync: (input: RegisterInput) => void
  readonly decide: (input: DecideInput) => Effect.Effect<Decision>
  readonly has: (id: string) => boolean
}

export class Service extends Context.Service<Service, Interface>()("@opencode/PermissionModule") {}

const RESERVED = new Set<string>(["allow", "ask", "deny"])

export function isReservedModuleID(id: string) {
  return RESERVED.has(id)
}

function makeRegistry(builtin: ReadonlyMap<string, DecideFn> = new Map()) {
  const custom = new Map<string, DecideFn>()

  const registerSync = (input: RegisterInput) => {
    const id = input.id.trim()
    if (!id) {
      throw new RegistrationError({ id: input.id, reason: "module id must be non-empty" })
    }
    if (isReservedModuleID(id)) {
      throw new RegistrationError({ id, reason: `"${id}" is a reserved permission action and cannot be registered` })
    }
    if (builtin.has(id) || custom.has(id)) {
      throw new RegistrationError({ id, reason: `permission module "${id}" is already registered` })
    }
    custom.set(id, input.decide)
  }

  const register = (input: RegisterInput) =>
    Effect.try({
      try: () => registerSync(input),
      catch: (error) => (error instanceof RegistrationError ? error : new RegistrationError({ id: input.id, reason: String(error) })),
    })

  const decide = Effect.fn("PermissionModule.decide")(function* (input: DecideInput) {
    const handler = builtin.get(input.moduleID) ?? custom.get(input.moduleID)
    if (!handler) {
      yield* Effect.logError("unknown permission module", { module: input.moduleID })
      return "deny" as const
    }
    return yield* handler(input)
  })

  const has = (id: string) => builtin.has(id) || custom.has(id)

  return Service.of({ register, registerSync, decide, has })
}

/** Empty registry: unknown modules deny. Built-ins must be provided by host layers. */
export const emptyLayer = Layer.sync(Service, () => makeRegistry())

export function layer(builtin: ReadonlyMap<string, DecideFn>) {
  return Layer.sync(Service, () => makeRegistry(builtin))
}
