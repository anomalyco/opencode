export * as SubagentJob from "./subagent-job.js"

import { Context, Deferred, Effect, Exit, Layer } from "effect"
import { Node } from "@opencode/util/effect/app-node"
import type { LayerNode } from "@opencode/util/effect/layer-node"
import type { Document, Entry } from "@opencode/schema/config"
import { Job } from "../job.js"
import { SessionExecution } from "./execution.js"
import { SessionSchema } from "./schema.js"

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
  readonly start: (recovery: Recovery) => Effect.Effect<Job.Info>
  /**
   * Takes one of the parent's slots for one child execution. Idempotent per child, so a follow-up on a
   * running child keeps its existing slot. False when no slot is free and the mode is `"fail"`, or when a
   * `"wait"` call is cancelled while queued.
   */
  readonly acquire: (input: {
    readonly parentSessionID: SessionSchema.ID
    readonly childSessionID: SessionSchema.ID
    readonly limit: number
    readonly mode: OverLimit
    readonly cancel?: Effect.Effect<void>
  }) => Effect.Effect<boolean>
  /** Frees a child's slot and wakes one queued call. Idempotent, so release paths may overlap. */
  readonly release: (parentSessionID: SessionSchema.ID, childSessionID: SessionSchema.ID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SubagentJob") {}

/** One busy period per parent: the children holding a slot, plus the doorbell for queued calls. */
type Slots = {
  readonly children: Set<SessionSchema.ID>
  waiting: Deferred.Deferred<void> | undefined
}

export function start(
  jobs: Job.Interface,
  execution: SessionExecution.Interface,
  recovery: Recovery,
  notificationID?: Job.Background["notificationID"],
  release?: Effect.Effect<void>,
) {
  const id = recovery.childSessionID
  return jobs.start({
    id,
    type: "subagent",
    title: recovery.description,
    metadata: notificationID === undefined ? {} : undefined,
    recovery,
    notificationID,
    background: true,
    run: execution.resume(id).pipe(
      // Only an explicit caller cancel releases the child's claim. A server shutdown
      // interrupts this job but must leave the child resumable on the next start.
      Effect.onInterrupt(() =>
        jobs.isCancelled(id).pipe(Effect.flatMap((cancelled) => (cancelled ? execution.interrupt(id) : Effect.void))),
      ),
      // The slot belongs to the run holding it; a follow-up that joins a running job skips this effect.
      Effect.ensuring(release ?? Effect.void),
      Effect.as(""),
    ),
  })
}

const make = Effect.gen(function* () {
  const execution = yield* SessionExecution.Service
  const jobs = yield* Job.Service
  // Jobs outlive the plugin that launched them. Fork with the global context too, rather
  // than retaining the caller's location.
  const context = yield* Effect.context<never>()
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

  return Service.of({
    start: (recovery) =>
      start(jobs, execution, recovery, undefined, release(recovery.parentSessionID, recovery.childSessionID)).pipe(
        Effect.setContext(context),
      ),
    acquire,
    release,
  })
})

export const layer = Layer.effect(Service, make)

export const node: LayerNode.Provider<Service, never, typeof Node.tags.values.global> = Node.makeGlobalNode({
  service: Service,
  layer,
  deps: [SessionExecution.node, Job.node],
})
