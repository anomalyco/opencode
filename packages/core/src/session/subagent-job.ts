export * as SubagentJob from "./subagent-job.js"

import { Context, Deferred, Effect, Exit, Layer, Scope } from "effect"
import { Node } from "@opencode/util/effect/app-node"
import type { LayerNode } from "@opencode/util/effect/layer-node"
import type { Document, Entry } from "@opencode/schema/config"
import { Job } from "../job.js"
import { Session } from "../session.js"
import { SessionSchema } from "./schema.js"
import { SubagentCompletion } from "./subagent-completion.js"

type Recovery = Extract<Job.Recovery, { kind: "subagent" }>

/** The unlimited cap, used when no config layer or override sets `experimental.subagent_concurrency`. */
export const unlimited = -1

export type OverLimit = "fail" | "wait"

export interface Limits {
  readonly limit: number
  readonly mode: OverLimit
  /** Override text that was set but rejected, so the caller can note it once. */
  readonly ignored: string | undefined
}

/**
 * `OPENCODE_SUBAGENT_CONCURRENCY`: a startup override for `experimental.subagent_concurrency`, ahead of
 * every config document, the way `OPENCODE_FLAGS` outranks `experimental.<flag>` in `Flag.resolve`.
 */
export const Concurrency = Context.Reference<string | undefined>("@opencode/SubagentJob/Concurrency", {
  defaultValue: () => process.env.OPENCODE_SUBAGENT_CONCURRENCY,
})

/**
 * Resolves the cap: the environment override, else the highest-priority document that sets each key.
 * Both keys are read per key instead of from one `experimental` block, so a global setting survives a
 * project block that only sets `subagent_depth`; see the same choice for `all_flags` in `Flag.resolve`.
 */
export function limits(input: { readonly entries: readonly Entry[]; readonly override?: string }): Limits {
  const override = parseOverride(input.override)
  return {
    limit: override ?? configured(input.entries, "subagent_concurrency") ?? unlimited,
    mode: configured(input.entries, "subagent_over_limit") ?? "fail",
    ignored: input.override === undefined || override !== undefined ? undefined : input.override,
  }
}

function parseOverride(value: string | undefined) {
  const text = value?.trim()
  if (!text) return undefined
  const parsed = Number(text)
  return Number.isInteger(parsed) && parsed >= unlimited ? parsed : undefined
}

function configured<K extends "subagent_concurrency" | "subagent_over_limit">(
  entries: readonly Entry[],
  key: K,
) {
  return entries.findLast(
    (entry): entry is Document => entry.type === "document" && entry.info.experimental?.[key] !== undefined,
  )?.info.experimental?.[key]
}

export interface Interface {
  start: (recovery: Recovery) => Effect.Effect<Job.Info>
  background: (recovery: Recovery) => Effect.Effect<void>
  notify: (recovery: Recovery, startedAt: number) => Effect.Effect<void>
  /**
   * Takes one of the parent's slots for one child execution. Idempotent per child, so a follow-up on a
   * running child keeps its existing slot. False when no slot is free and the mode is `"fail"`, or when a
   * `"wait"` call is cancelled while queued.
   */
  acquire: (input: {
    readonly parentSessionID: SessionSchema.ID
    readonly childSessionID: SessionSchema.ID
    readonly limit: number
    readonly mode: OverLimit
    readonly cancel?: Effect.Effect<void>
  }) => Effect.Effect<boolean>
  /** Frees a child's slot and wakes one queued call. Idempotent, so release paths may overlap. */
  release: (parentSessionID: SessionSchema.ID, childSessionID: SessionSchema.ID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SubagentJob") {}

/** One busy period per parent: the children holding a slot, plus the doorbell for queued calls. */
type Slots = {
  readonly children: Set<SessionSchema.ID>
  waiting: Deferred.Deferred<void> | undefined
}

const make: Effect.Effect<Interface, never, Session.Service | Job.Service | Scope.Scope> = Effect.gen(function* () {
  const sessions = yield* Session.Service
  const jobs = yield* Job.Service
  const scope = yield* Scope.Scope
  // Jobs and their completion observers outlive the plugin that launched them.
  // Fork with the global context too, rather than retaining the caller's location.
  const context = yield* Effect.context<never>()
  // One observer per job generation, including continuations of the same child.
  const notifications = new Set<string>()
  // Process-local, like the Job registry this mirrors: a restart re-registers recovered work.
  const slots = new Map<SessionSchema.ID, Slots>()

  const release: Interface["release"] = (parentSessionID, childSessionID) =>
    Effect.sync(() => {
      const entry = slots.get(parentSessionID)
      if (!entry) return
      entry.children.delete(childSessionID)
      const waiting = entry.waiting
      if (waiting === undefined) return
      entry.waiting = undefined
      Deferred.doneUnsafe(waiting, Exit.void)
    })

  const acquire: Interface["acquire"] = Effect.fn("SubagentJob.acquire")(function* (input) {
    // Unlimited and disabled need no bookkeeping at all, so the common unset case stays inert.
    if (input.limit < 0) return true
    if (input.limit === 0) return false
    const entry = slots.get(input.parentSessionID) ?? { children: new Set<SessionSchema.ID>(), waiting: undefined }
    slots.set(input.parentSessionID, entry)
    if (entry.children.has(input.childSessionID)) return true
    if (entry.children.size < input.limit) {
      entry.children.add(input.childSessionID)
      return true
    }
    if (input.mode === "fail") return false
    const waiting = (entry.waiting ??= Deferred.makeUnsafe<void>())
    const woken = yield* Effect.raceFirst(
      Deferred.await(waiting).pipe(Effect.as("ready" as const)),
      (input.cancel ?? Effect.never).pipe(Effect.as("cancelled" as const)),
    )
    if (woken === "cancelled") return false
    return yield* acquire(input)
  })

  const notify = Effect.fn("SubagentJob.notify")(function* (recovery: Recovery, startedAt: number) {
    const key = `${recovery.childSessionID}:${startedAt}`
    if (notifications.has(key)) return
    notifications.add(key)
    yield* Effect.gen(function* () {
      const info = (yield* jobs.wait({ id: recovery.childSessionID })).info
      if (info) yield* SubagentCompletion.deliver(sessions, jobs, { ...info, recovery })
    }).pipe(
      // A backgrounded child's slot belongs to this observer, not to the call that launched it.
      Effect.ensuring(release(recovery.parentSessionID, recovery.childSessionID)),
      Effect.ensuring(Effect.sync(() => notifications.delete(key))),
      // The global context drops the caller's span annotations; delivery is the parent session's work.
      Effect.annotateSpans("session.id", recovery.parentSessionID),
      Effect.forkIn(scope, { startImmediately: true }),
      Effect.setContext(context),
    )
  })

  return Service.of({
    start: (recovery: Recovery) =>
      jobs
        .start({
          id: recovery.childSessionID,
          type: "subagent",
          title: recovery.description,
          metadata: {},
          recovery,
          run: Effect.gen(function* () {
            yield* sessions.resume(recovery.childSessionID)
            const messages = yield* sessions.messages({ sessionID: recovery.childSessionID, order: "desc", limit: 20 })
            const assistant = messages.find(
              (message) =>
                message.type === "assistant" && message.time.completed !== undefined && message.error === undefined,
            )
            return SubagentCompletion.text(assistant)
          }),
        })
        .pipe(Effect.setContext(context)),
    background: Effect.fn("SubagentJob.background")(function* (recovery: Recovery) {
      const info = yield* jobs.background(recovery.childSessionID)
      if (!info) return yield* release(recovery.parentSessionID, recovery.childSessionID)
      yield* notify(recovery, info.started_at)
    }),
    notify,
    acquire,
    release,
  })
})

export const node: LayerNode.Provider<Service, never, typeof Node.tags.values.global> = Node.makeGlobalNode({
  service: Service,
  layer: Layer.effect(Service, make),
  deps: [Session.node, Job.node],
})
