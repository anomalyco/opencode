export * as AgentManager from "./agent-manager"

import { Clock, Context, Effect, Layer, Schema, SynchronizedRef } from "effect"
import { Identifier } from "./id/id"
import { makeGlobalNode } from "./effect/app-node"

/**
 * AgentManager — Fase 1 (agent-first). Process-local runtime registry of agent
 * records: lifecycle, token/time budgets, checkpoints, logs, and hierarchy.
 *
 * Follows the BackgroundJob registry shape (SynchronizedRef + `make` engine +
 * global node). Entries are intentionally not durable: process restart loses
 * records. Durable ownership and remote workers need a separate slice.
 *
 * Status vocabulary is lowercase house style mapping the Fase 1 states
 * (IDLE → idle, …). `archived` is a tenth state beyond the nine specified:
 * the required archive operation needs a terminal state distinct from
 * cancelled/completed.
 *
 * Budget rules:
 * - Token budget gates forward motion (plan/start/resume/unblock/verify)
 *   through an explicit advisory pre-check. Recording and gating are separate
 *   atomic steps; a writer racing between them only delays the next gate.
 * - Settling (complete/fail/cancel/archive) is never gated so an over-budget
 *   agent can always be closed.
 * - Time budget is enforced only by explicit `checkTimeBudget(id, now)` —
 *   the future scheduler (Fase 21) polls it. Motion ops never consult clocks
 *   beyond stamping, keeping transitions deterministic.
 *
 * Duplicate copies the spec fresh (no history). Clone copies spec plus
 * checkpoints and logs with fresh IDs (same parent — a sibling retry with
 * visible history).
 */

export type Status =
  | "idle"
  | "planning"
  | "running"
  | "waiting"
  | "blocked"
  | "verifying"
  | "completed"
  | "failed"
  | "cancelled"
  | "archived"

export type Priority = "low" | "normal" | "high" | "urgent"

export type LogLevel = "debug" | "info" | "warn" | "error"

export interface Checkpoint {
  readonly id: string
  readonly label: string
  readonly createdAt: number
  readonly sessionID?: string
}

export interface LogEntry {
  readonly createdAt: number
  readonly level: LogLevel
  readonly message: string
}

export interface Info {
  id: string
  name: string
  status: Status
  parentID?: string
  sessionID?: string
  workspace: string
  branch?: string
  worktree?: string
  model?: string
  provider?: string
  allowedTools?: string[]
  permissions?: string[]
  tokenBudget?: number
  timeBudgetMs?: number
  priority: Priority
  context?: Record<string, unknown>
  checkpoints: Checkpoint[]
  logs: LogEntry[]
  result?: string
  error?: string
  tokensUsed: number
  createdAt: number
  updatedAt: number
  startedAt?: number
  completedAt?: number
  deadlineMs?: number
}

export interface CreateInput {
  readonly name?: string
  readonly parentID?: string
  readonly sessionID?: string
  readonly workspace: string
  readonly branch?: string
  readonly worktree?: string
  readonly model?: string
  readonly provider?: string
  readonly allowedTools?: readonly string[]
  readonly permissions?: readonly string[]
  readonly tokenBudget?: number
  readonly timeBudgetMs?: number
  readonly priority?: Priority
  readonly context?: Record<string, unknown>
}

export interface CopyOverrides {
  readonly name?: string
  readonly parentID?: string
  readonly workspace?: string
  readonly model?: string
  readonly provider?: string
}

export interface ListFilter {
  readonly status?: Status | readonly Status[]
  readonly parentID?: string
  readonly includeArchived?: boolean
}

export interface RecordUsageInput {
  readonly id: string
  readonly tokens: number
  readonly now?: number
}

export interface CheckpointInput {
  readonly label: string
  readonly sessionID?: string
  readonly now?: number
}

export interface LogInput {
  readonly level: LogLevel
  readonly message: string
  readonly now?: number
}

export class AgentNotFoundError extends Schema.TaggedErrorClass<AgentNotFoundError>()("AgentManagerNotFound", {
  id: Schema.String,
}) {}

export class InvalidTransitionError extends Schema.TaggedErrorClass<InvalidTransitionError>()(
  "AgentManagerInvalidTransition",
  {
    id: Schema.String,
    from: Schema.String,
    to: Schema.String,
  },
) {}

export class BudgetExceededError extends Schema.TaggedErrorClass<BudgetExceededError>()("AgentManagerBudgetExceeded", {
  id: Schema.String,
  kind: Schema.Literals(["tokens", "time"]),
  used: Schema.Number,
  budget: Schema.Number,
}) {}

export class InvalidUsageError extends Schema.TaggedErrorClass<InvalidUsageError>()("AgentManagerInvalidUsage", {
  id: Schema.String,
  message: Schema.String,
}) {}

export interface Interface {
  readonly create: (input: CreateInput) => Effect.Effect<Info, InvalidUsageError>
  readonly get: (id: string) => Effect.Effect<Info | undefined>
  readonly list: (filter?: ListFilter) => Effect.Effect<Info[]>
  readonly plan: (id: string) => Effect.Effect<Info, AgentNotFoundError | InvalidTransitionError | BudgetExceededError>
  readonly start: (id: string) => Effect.Effect<Info, AgentNotFoundError | InvalidTransitionError | BudgetExceededError>
  readonly pause: (id: string) => Effect.Effect<Info, AgentNotFoundError | InvalidTransitionError>
  readonly resume: (
    id: string,
  ) => Effect.Effect<Info, AgentNotFoundError | InvalidTransitionError | BudgetExceededError>
  readonly block: (id: string, reason?: string) => Effect.Effect<Info, AgentNotFoundError | InvalidTransitionError>
  readonly unblock: (
    id: string,
  ) => Effect.Effect<Info, AgentNotFoundError | InvalidTransitionError | BudgetExceededError>
  readonly verify: (
    id: string,
  ) => Effect.Effect<Info, AgentNotFoundError | InvalidTransitionError | BudgetExceededError>
  readonly complete: (id: string, result?: string) => Effect.Effect<Info, AgentNotFoundError | InvalidTransitionError>
  readonly fail: (id: string, error: string) => Effect.Effect<Info, AgentNotFoundError | InvalidTransitionError>
  readonly cancel: (id: string) => Effect.Effect<Info, AgentNotFoundError | InvalidTransitionError>
  readonly archive: (id: string) => Effect.Effect<Info, AgentNotFoundError | InvalidTransitionError>
  readonly rename: (
    id: string,
    name: string,
  ) => Effect.Effect<Info, AgentNotFoundError | InvalidTransitionError | InvalidUsageError>
  readonly duplicate: (id: string, overrides?: CopyOverrides) => Effect.Effect<Info, AgentNotFoundError>
  readonly clone: (id: string, overrides?: CopyOverrides) => Effect.Effect<Info, AgentNotFoundError>
  readonly recordUsage: (
    input: RecordUsageInput,
  ) => Effect.Effect<Info, AgentNotFoundError | InvalidTransitionError | InvalidUsageError>
  readonly checkpoint: (
    id: string,
    input: CheckpointInput,
  ) => Effect.Effect<Checkpoint, AgentNotFoundError | InvalidTransitionError | InvalidUsageError>
  readonly log: (id: string, input: LogInput) => Effect.Effect<LogEntry, AgentNotFoundError | InvalidUsageError>
  readonly checkTimeBudget: (
    id: string,
    now: number,
  ) => Effect.Effect<Info, AgentNotFoundError | InvalidTransitionError | BudgetExceededError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/AgentManager") {}

const Transitions: Record<Status, readonly Status[]> = {
  idle: ["planning", "running", "cancelled", "archived"],
  planning: ["running", "waiting", "blocked", "cancelled", "archived"],
  running: ["waiting", "blocked", "verifying", "completed", "failed", "cancelled"],
  waiting: ["running", "blocked", "cancelled", "archived"],
  blocked: ["waiting", "running", "cancelled"],
  verifying: ["completed", "failed", "blocked", "running", "cancelled"],
  completed: ["archived"],
  failed: ["running", "cancelled", "archived"],
  cancelled: ["archived"],
  archived: [],
}

const Terminal: readonly Status[] = ["completed", "failed", "cancelled", "archived"]

function snapshot(info: Info): Info {
  return {
    ...info,
    ...(info.allowedTools ? { allowedTools: [...info.allowedTools] } : {}),
    ...(info.permissions ? { permissions: [...info.permissions] } : {}),
    ...(info.context ? { context: { ...info.context } } : {}),
    checkpoints: info.checkpoints.map((checkpoint) => ({ ...checkpoint })),
    logs: info.logs.map((entry) => ({ ...entry })),
  }
}

type Store = Map<string, Info>

type TransitionResult =
  | { readonly _tag: "missing" }
  | { readonly _tag: "invalid"; readonly from: Status }
  | { readonly _tag: "ok"; readonly info: Info }

type CopyResult = { readonly _tag: "missing" } | { readonly _tag: "ok"; readonly info: Info }

export const make = Effect.gen(function* () {
  const agents: SynchronizedRef.SynchronizedRef<Store> = yield* SynchronizedRef.make(new Map())

  const move = Effect.fn("AgentManager.move")(function* (
    id: string,
    to: Status,
    mutate?: (draft: Info, now: number) => void,
  ) {
    const now = yield* Clock.currentTimeMillis
    const result = yield* SynchronizedRef.modify(agents, (all): readonly [TransitionResult, Store] => {
      const current = all.get(id)
      if (!current) return [{ _tag: "missing" } as const, all]
      if (!Transitions[current.status].includes(to)) return [{ _tag: "invalid", from: current.status } as const, all]
      const next: Info = { ...current, status: to, updatedAt: now }
      mutate?.(next, now)
      return [{ _tag: "ok", info: snapshot(next) } as const, new Map(all).set(id, next)]
    })
    if (result._tag === "missing") return yield* new AgentNotFoundError({ id })
    if (result._tag === "invalid") return yield* new InvalidTransitionError({ id, from: result.from, to })
    return result.info
  })

  const requireTokenBudget = Effect.fn("AgentManager.requireTokenBudget")(function* (id: string) {
    const current = (yield* SynchronizedRef.get(agents)).get(id)
    if (!current) return yield* new AgentNotFoundError({ id })
    if (current.tokenBudget !== undefined && current.tokensUsed > current.tokenBudget) {
      return yield* new BudgetExceededError({
        id,
        kind: "tokens",
        used: current.tokensUsed,
        budget: current.tokenBudget,
      })
    }
    return snapshot(current)
  })

  const gated = Effect.fn("AgentManager.gated")(function* (
    id: string,
    to: Status,
    mutate?: (draft: Info, now: number) => void,
  ) {
    yield* requireTokenBudget(id)
    return yield* move(id, to, mutate)
  })

  const create: Interface["create"] = Effect.fn("AgentManager.create")(function* (input: CreateInput) {
    if (input.name !== undefined && !input.name.trim()) {
      return yield* new InvalidUsageError({ id: "", message: "name must not be empty" })
    }
    const now = yield* Clock.currentTimeMillis
    const id = Identifier.ascending("agent")
    const info: Info = {
      id,
      name: input.name?.trim() ? input.name.trim() : `agent-${id}`,
      status: "idle",
      workspace: input.workspace,
      priority: input.priority ?? "normal",
      checkpoints: [],
      logs: [],
      tokensUsed: 0,
      createdAt: now,
      updatedAt: now,
      ...(input.parentID ? { parentID: input.parentID } : {}),
      ...(input.sessionID ? { sessionID: input.sessionID } : {}),
      ...(input.branch ? { branch: input.branch } : {}),
      ...(input.worktree ? { worktree: input.worktree } : {}),
      ...(input.model ? { model: input.model } : {}),
      ...(input.provider ? { provider: input.provider } : {}),
      ...(input.allowedTools ? { allowedTools: [...input.allowedTools] } : {}),
      ...(input.permissions ? { permissions: [...input.permissions] } : {}),
      ...(input.tokenBudget !== undefined ? { tokenBudget: input.tokenBudget } : {}),
      ...(input.timeBudgetMs !== undefined ? { timeBudgetMs: input.timeBudgetMs } : {}),
      ...(input.context ? { context: { ...input.context } } : {}),
    }
    yield* SynchronizedRef.update(agents, (all) => new Map(all).set(id, info))
    return snapshot(info)
  })

  const get: Interface["get"] = Effect.fn("AgentManager.get")(function* (id: string) {
    const current = (yield* SynchronizedRef.get(agents)).get(id)
    if (!current) return undefined
    return snapshot(current)
  })

  const list: Interface["list"] = Effect.fn("AgentManager.list")(function* (filter?: ListFilter) {
    const statuses = filter?.status === undefined ? undefined : [filter.status].flat()
    return Array.from((yield* SynchronizedRef.get(agents)).values())
      .filter((info) => filter?.includeArchived !== false || info.status !== "archived")
      .filter((info) => (statuses ? statuses.includes(info.status) : true))
      .filter((info) => (filter?.parentID !== undefined ? info.parentID === filter.parentID : true))
      .map(snapshot)
      .toSorted((a, b) => a.createdAt - b.createdAt)
  })

  const markStarted = (draft: Info, now: number) => {
    if (draft.startedAt === undefined) {
      draft.startedAt = now
      if (draft.timeBudgetMs !== undefined) draft.deadlineMs = now + draft.timeBudgetMs
    }
  }

  const appendLog = (draft: Info, now: number, level: LogEntry["level"], message: string) => {
    draft.logs.push({ createdAt: now, level, message })
  }

  const plan: Interface["plan"] = Effect.fn("AgentManager.plan")(function* (id: string) {
    return yield* gated(id, "planning")
  })

  const start: Interface["start"] = Effect.fn("AgentManager.start")(function* (id: string) {
    return yield* gated(id, "running", markStarted)
  })

  const pause: Interface["pause"] = (id) => move(id, "waiting")

  const resume: Interface["resume"] = Effect.fn("AgentManager.resume")(function* (id: string) {
    return yield* gated(id, "running", markStarted)
  })

  const block: Interface["block"] = Effect.fn("AgentManager.block")(function* (id: string, reason?: string) {
    return yield* move(id, "blocked", (draft, now) =>
      appendLog(draft, now, "warn", `Blocked: ${reason?.trim() ? reason.trim() : "no reason given"}`),
    )
  })

  const unblock: Interface["unblock"] = Effect.fn("AgentManager.unblock")(function* (id: string) {
    return yield* gated(id, "waiting")
  })

  const verify: Interface["verify"] = Effect.fn("AgentManager.verify")(function* (id: string) {
    return yield* gated(id, "verifying")
  })

  const complete: Interface["complete"] = Effect.fn("AgentManager.complete")(function* (id: string, result?: string) {
    return yield* move(id, "completed", (draft, now) => {
      if (result !== undefined) draft.result = result
      delete draft.error
      draft.completedAt = now
      appendLog(draft, now, "info", "Completed")
    })
  })

  const fail: Interface["fail"] = Effect.fn("AgentManager.fail")(function* (id: string, error: string) {
    return yield* move(id, "failed", (draft, now) => {
      draft.error = error
      delete draft.result
      draft.completedAt = now
      appendLog(draft, now, "error", error)
    })
  })

  const cancel: Interface["cancel"] = Effect.fn("AgentManager.cancel")(function* (id: string) {
    return yield* move(id, "cancelled", (draft, now) => {
      draft.completedAt = now
      appendLog(draft, now, "warn", "Cancelled")
    })
  })

  const archive: Interface["archive"] = (id) => move(id, "archived")

  const rename: Interface["rename"] = Effect.fn("AgentManager.rename")(function* (id: string, name: string) {
    if (!name.trim()) return yield* new InvalidUsageError({ id, message: "name must not be empty" })
    const now = yield* Clock.currentTimeMillis
    const result = yield* SynchronizedRef.modify(agents, (all): readonly [TransitionResult, Store] => {
      const current = all.get(id)
      if (!current) return [{ _tag: "missing" } as const, all]
      if (current.status === "archived") return [{ _tag: "invalid", from: current.status } as const, all]
      const next: Info = { ...current, name: name.trim(), updatedAt: now }
      return [{ _tag: "ok", info: snapshot(next) } as const, new Map(all).set(id, next)]
    })
    if (result._tag === "missing") return yield* new AgentNotFoundError({ id })
    if (result._tag === "invalid") return yield* new InvalidTransitionError({ id, from: result.from, to: result.from })
    return result.info
  })

  const copy = Effect.fn("AgentManager.copy")(function* (
    id: string,
    overrides: CopyOverrides | undefined,
    deep: boolean,
  ) {
    const now = yield* Clock.currentTimeMillis
    const result = yield* SynchronizedRef.modify(agents, (all): readonly [CopyResult, Store] => {
      const source = all.get(id)
      if (!source) return [{ _tag: "missing" } as const, all]
      const fresh: Info = {
        ...snapshot(source),
        id: Identifier.ascending("agent"),
        name: overrides?.name?.trim() ? overrides.name.trim() : `${source.name} copy`,
        status: "idle",
        checkpoints: deep
          ? source.checkpoints.map((checkpoint) => ({ ...checkpoint, id: Identifier.create("ckpt", "ascending") }))
          : [],
        logs: deep ? source.logs.map((entry) => ({ ...entry })) : [],
        tokensUsed: 0,
        createdAt: now,
        updatedAt: now,
        ...(overrides?.parentID !== undefined ? { parentID: overrides.parentID } : {}),
        ...(overrides?.workspace !== undefined ? { workspace: overrides.workspace } : {}),
        ...(overrides?.model !== undefined ? { model: overrides.model } : {}),
        ...(overrides?.provider !== undefined ? { provider: overrides.provider } : {}),
      }
      delete fresh.result
      delete fresh.error
      delete fresh.startedAt
      delete fresh.completedAt
      delete fresh.deadlineMs
      return [{ _tag: "ok", info: snapshot(fresh) } as const, new Map(all).set(fresh.id, fresh)]
    })
    if (result._tag === "missing") return yield* new AgentNotFoundError({ id })
    return result.info
  })

  const duplicate: Interface["duplicate"] = (id, overrides) => copy(id, overrides, false)

  const clone: Interface["clone"] = (id, overrides) => copy(id, overrides, true)

  const recordUsage: Interface["recordUsage"] = Effect.fn("AgentManager.recordUsage")(function* (
    input: RecordUsageInput,
  ) {
    if (input.tokens < 0) return yield* new InvalidUsageError({ id: input.id, message: "tokens must not be negative" })
    const now = input.now ?? (yield* Clock.currentTimeMillis)
    const result = yield* SynchronizedRef.modify(agents, (all): readonly [TransitionResult, Store] => {
      const current = all.get(input.id)
      if (!current) return [{ _tag: "missing" } as const, all]
      if (Terminal.includes(current.status)) return [{ _tag: "invalid", from: current.status } as const, all]
      const next: Info = { ...current, tokensUsed: current.tokensUsed + input.tokens, updatedAt: now }
      return [{ _tag: "ok", info: snapshot(next) } as const, new Map(all).set(input.id, next)]
    })
    if (result._tag === "missing") return yield* new AgentNotFoundError({ id: input.id })
    if (result._tag === "invalid") {
      return yield* new InvalidTransitionError({ id: input.id, from: result.from, to: result.from })
    }
    return result.info
  })

  const checkpoint: Interface["checkpoint"] = Effect.fn("AgentManager.checkpoint")(function* (
    id: string,
    input: CheckpointInput,
  ) {
    if (!input.label.trim()) return yield* new InvalidUsageError({ id, message: "label must not be empty" })
    const now = input.now ?? (yield* Clock.currentTimeMillis)
    const entry: Checkpoint = {
      id: Identifier.create("ckpt", "ascending"),
      label: input.label.trim(),
      createdAt: now,
      ...(input.sessionID ? { sessionID: input.sessionID } : {}),
    }
    const result = yield* SynchronizedRef.modify(agents, (all): readonly [TransitionResult, Store] => {
      const current = all.get(id)
      if (!current) return [{ _tag: "missing" } as const, all]
      if (Terminal.includes(current.status)) return [{ _tag: "invalid", from: current.status } as const, all]
      const next: Info = {
        ...current,
        checkpoints: [...current.checkpoints, entry],
        updatedAt: now,
      }
      return [{ _tag: "ok", info: snapshot(next) } as const, new Map(all).set(id, next)]
    })
    if (result._tag === "missing") return yield* new AgentNotFoundError({ id })
    if (result._tag === "invalid") return yield* new InvalidTransitionError({ id, from: result.from, to: result.from })
    return entry
  })

  const log: Interface["log"] = Effect.fn("AgentManager.log")(function* (id: string, input: LogInput) {
    if (!input.message.trim()) return yield* new InvalidUsageError({ id, message: "message must not be empty" })
    const now = input.now ?? (yield* Clock.currentTimeMillis)
    const entry: LogEntry = { createdAt: now, level: input.level, message: input.message }
    const missing = yield* SynchronizedRef.modify(agents, (all) => {
      const current = all.get(id)
      if (!current) return [true, all] as const
      const next: Info = { ...current, logs: [...current.logs, entry], updatedAt: now }
      return [false, new Map(all).set(id, next)] as const
    })
    if (missing) return yield* new AgentNotFoundError({ id })
    return entry
  })

  const checkTimeBudget: Interface["checkTimeBudget"] = Effect.fn("AgentManager.checkTimeBudget")(function* (
    id: string,
    now: number,
  ) {
    const current = (yield* SynchronizedRef.get(agents)).get(id)
    if (!current) return yield* new AgentNotFoundError({ id })
    if (Terminal.includes(current.status)) {
      return yield* new InvalidTransitionError({ id, from: current.status, to: current.status })
    }
    if (current.deadlineMs === undefined || now <= current.deadlineMs) return snapshot(current)
    const deadlineMs = current.deadlineMs
    if (current.status !== "blocked") {
      yield* move(id, "blocked", (draft, stamped) =>
        appendLog(draft, stamped, "warn", `Time budget exceeded at ${new Date(now).toISOString()}`),
      )
    }
    return yield* new BudgetExceededError({ id, kind: "time", used: now, budget: deadlineMs })
  })

  return Service.of({
    create,
    get,
    list,
    plan,
    start,
    pause,
    resume,
    block,
    unblock,
    verify,
    complete,
    fail,
    cancel,
    archive,
    rename,
    duplicate,
    clone,
    recordUsage,
    checkpoint,
    log,
    checkTimeBudget,
  })
})

const layer = Layer.effect(Service, make)

export const node = makeGlobalNode({ service: Service, layer, deps: [] })
