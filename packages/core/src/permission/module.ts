export * as PermissionModule from "./module"

import { Context, Effect, Layer, Schema } from "effect"
import { PermissionModule as PermissionModuleSchema } from "@opencode-ai/schema/permission-module"

export type Decision = PermissionModuleSchema.Decision

export interface DecideResult {
  decision: Decision
  /** Short human-facing rationale from the classifier or safety rails. */
  reason?: string
  /** Optional module-specific details for internal consumers. */
  metadata?: Record<string, unknown>
}

export interface DecideInput {
  moduleID: string
  permission: string
  patterns: readonly string[]
  metadata: Record<string, unknown>
  /** Relevant current user prompt when the host can provide it explicitly. */
  userPrompt?: string
  /**
   * Filtered session projection for classifiers (user messages + tool call name/args).
   * Must not include assistant text, reasoning, or tool results.
   */
  sessionContext?: readonly unknown[]
  /**
   * Host-only enriched prompt used for deterministic affirmation matching.
   * Must not be forwarded to the classifier LLM.
   */
  approvalPrompt?: string
  /** Host-defined execution scope used to select a scoped registration. */
  scope?: string
  /** Host-defined cache scope for one user-prompt turn. */
  cacheScope?: string
}

/** Handlers may return a bare decision or a result with an optional reason. */
export type DecideFn = (input: DecideInput) => Effect.Effect<Decision | DecideResult>

function isDecision(value: unknown): value is Decision {
  return value === "allow" || value === "deny" || value === "ask"
}

function isDecideResult(value: unknown): value is DecideResult {
  if (typeof value !== "object" || value === null || !("decision" in value)) return false
  return isDecision(value.decision)
}

export function normalizeDecide(outcome: unknown): DecideResult {
  if (isDecision(outcome)) return { decision: outcome }
  if (!isDecideResult(outcome)) return { decision: "deny" }
  const reason = "reason" in outcome && typeof outcome.reason === "string" ? outcome.reason : undefined
  const metadata =
    "metadata" in outcome &&
    typeof outcome.metadata === "object" &&
    outcome.metadata !== null &&
    !Array.isArray(outcome.metadata)
      ? (outcome.metadata as Record<string, unknown>)
      : undefined
  return {
    decision: outcome.decision,
    ...(reason !== undefined ? { reason } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
  }
}

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
  readonly scope?: string
}

export interface Interface {
  readonly register: (input: RegisterInput) => Effect.Effect<() => void, RegistrationError>
  readonly registerSync: (input: RegisterInput) => () => void
  readonly decide: (input: DecideInput) => Effect.Effect<DecideResult>
  readonly has: (id: string, scope?: string) => boolean
}

export class Service extends Context.Service<Service, Interface>()("@opencode/PermissionModule") {}

const RESERVED = new Set<string>(["allow", "ask", "deny"])

export function isReservedModuleID(id: string) {
  return RESERVED.has(id)
}

function makeRegistry(builtin: ReadonlyMap<string, DecideFn> = new Map()) {
  const custom = new Map<string, Map<string, DecideFn>>()
  const scopeKey = (scope: string | undefined) => scope ?? ""

  const registerSync = (input: RegisterInput) => {
    const id = input.id.trim()
    if (!id) {
      throw new RegistrationError({ id: input.id, reason: "module id must be non-empty" })
    }
    if (isReservedModuleID(id)) {
      throw new RegistrationError({ id, reason: `"${id}" is a reserved permission action and cannot be registered` })
    }
    const key = scopeKey(input.scope)
    const registrations = custom.get(id) ?? new Map<string, DecideFn>()
    if (builtin.has(id) || registrations.has(key)) {
      throw new RegistrationError({ id, reason: `permission module "${id}" is already registered` })
    }
    registrations.set(key, input.decide)
    custom.set(id, registrations)
    return () => {
      if (registrations.get(key) !== input.decide) return
      registrations.delete(key)
      if (registrations.size === 0) custom.delete(id)
    }
  }

  const register = (input: RegisterInput) =>
    Effect.try({
      try: () => registerSync(input),
      catch: (error) =>
        error instanceof RegistrationError ? error : new RegistrationError({ id: input.id, reason: String(error) }),
    })

  const decide = Effect.fn("PermissionModule.decide")(function* (input: DecideInput) {
    const registrations = custom.get(input.moduleID)
    const handler =
      builtin.get(input.moduleID) ??
      registrations?.get(scopeKey(input.scope)) ??
      registrations?.get(scopeKey(undefined))
    if (!handler) {
      yield* Effect.logError("unknown permission module", { module: input.moduleID })
      return { decision: "deny" as const }
    }
    const outcome = yield* handler(input)
    const normalized = normalizeDecide(outcome)
    if (!isDecision(outcome) && !isDecideResult(outcome)) {
      yield* Effect.logError("invalid permission module decision", { module: input.moduleID })
    }
    return normalized
  })

  const has = (id: string, scope?: string) =>
    builtin.has(id) ||
    custom.get(id)?.has(scopeKey(scope)) === true ||
    custom.get(id)?.has(scopeKey(undefined)) === true

  return Service.of({ register, registerSync, decide, has })
}

/** Empty registry: unknown modules deny. Built-ins must be provided by host layers. */
export const emptyLayer = Layer.sync(Service, () => makeRegistry())

export function layer(builtin: ReadonlyMap<string, DecideFn>) {
  return Layer.sync(Service, () => makeRegistry(builtin))
}
