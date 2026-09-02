export * as PermissionLedger from "./ledger.js"

import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import { Context, Deferred, Effect, Layer, Schema } from "effect"
import { Permission } from "@opencode-ai/schema/permission"
import { Project } from "@opencode-ai/schema/project"
import { Agent } from "../agent.js"
import { Bus } from "../bus.js"
import { Location } from "../location.js"
import { SessionSchema } from "../session/schema.js"
import { PermissionSaved } from "./saved.js"

export const ReplyInput = Schema.Struct({
  requestID: Permission.ID,
  reply: Permission.Reply,
  message: Schema.String.pipe(Schema.optional),
}).annotate({ identifier: "Permission.ReplyInput" })
export type ReplyInput = typeof ReplyInput.Type

export class DeclinedError extends Schema.TaggedError<DeclinedError>()("Permission.DeclinedError", {}) {}

export class CorrectedError extends Schema.TaggedError<CorrectedError>()("Permission.CorrectedError", {
  feedback: Schema.String,
}) {}

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("Permission.NotFoundError", {
  requestID: Permission.ID,
}) {}

export interface RegisterInput {
  readonly request: Permission.Request
  readonly agent?: Agent.ID
  /** Placement of the asking instance; events route to clients watching it. */
  readonly location: Location.Ref
  readonly projectID: Project.ID
  /** Re-runs the asker's policy after saved rules change; `undefined` once the Session is gone. */
  readonly reevaluate: Effect.Effect<Permission.Effect | undefined>
}

/**
 * A registered request stays pending until replied or cancelled. The registering fiber owns
 * the entry: attach `cancel` with `Effect.ensuring` inside the uninterruptible region that
 * registered, so an interrupt landing during registration cannot orphan it.
 */
export interface Registration {
  readonly request: Permission.Request
  readonly await: Effect.Effect<void, DeclinedError | CorrectedError>
  /** Drops an unanswered request and tells clients it was rejected; no-op once replied. */
  readonly cancel: Effect.Effect<void>
}

/** Host-wide pending permission requests, keyed by request and owned by the fiber awaiting each one. */
export interface Interface {
  readonly register: (input: RegisterInput) => Effect.Effect<Registration>
  readonly reply: (input: ReplyInput) => Effect.Effect<void, NotFoundError>
  readonly get: (id: Permission.ID) => Effect.Effect<Permission.Request | undefined>
  readonly forSession: (sessionID: SessionSchema.ID) => Effect.Effect<ReadonlyArray<Permission.Request>>
  readonly list: (location?: Location.Ref) => Effect.Effect<ReadonlyArray<Permission.Request>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/PermissionLedger") {}

interface Pending extends RegisterInput {
  readonly deferred: Deferred.Deferred<void, DeclinedError | CorrectedError>
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const saved = yield* PermissionSaved.Service
    const pending = new Map<Permission.ID, Pending>()

    const replied = (item: Pending, reply: Permission.Reply) =>
      bus.publish(
        Permission.Event.Replied,
        { sessionID: item.request.sessionID, requestID: item.request.id, reply },
        { location: item.location },
      )

    // Only an abandoned asker reaches this with a live entry: a reply always removes it first.
    const cancel = (id: Permission.ID) =>
      Effect.gen(function* () {
        const item = pending.get(id)
        if (!item) return
        pending.delete(id)
        yield* Deferred.fail(item.deferred, new DeclinedError())
        yield* replied(item, "reject")
      })

    const register = Effect.fn("PermissionLedger.register")((input: RegisterInput) =>
      Effect.uninterruptible(
        Effect.gen(function* () {
          const deferred = yield* Deferred.make<void, DeclinedError | CorrectedError>()
          if (pending.has(input.request.id))
            return yield* Effect.die(new Error(`Duplicate pending permission ID: ${input.request.id}`))
          pending.set(input.request.id, { ...input, deferred })
          yield* bus
            .publish(Permission.Event.Asked, input.request, { location: input.location })
            .pipe(Effect.onError(() => Effect.sync(() => pending.delete(input.request.id))))
          return {
            request: input.request,
            await: Deferred.await(deferred),
            cancel: cancel(input.request.id),
          } satisfies Registration
        }),
      ),
    )

    const reply = Effect.fn("PermissionLedger.reply")((input: ReplyInput) =>
      Effect.uninterruptible(
        Effect.gen(function* () {
          const existing = pending.get(input.requestID)
          if (!existing) return yield* new NotFoundError({ requestID: input.requestID })
          yield* replied(existing, input.reply)

          // Remove before settling so the woken asker's cleanup finds nothing to cancel.
          pending.delete(input.requestID)
          if (input.reply === "reject") {
            yield* Deferred.fail(
              existing.deferred,
              input.message ? new CorrectedError({ feedback: input.message }) : new DeclinedError(),
            )
            for (const [id, item] of pending) {
              if (item.request.sessionID !== existing.request.sessionID) continue
              pending.delete(id)
              yield* replied(item, "reject")
              yield* Deferred.fail(item.deferred, new DeclinedError())
            }
            return
          }

          if (input.reply === "always" && existing.request.save?.length) {
            yield* saved.add({
              projectID: existing.projectID,
              action: existing.request.action,
              resources: existing.request.save,
            })
          }
          yield* Deferred.succeed(existing.deferred, undefined)
          if (input.reply !== "always" || !existing.request.save?.length) return

          for (const [id, item] of pending) {
            if ((yield* item.reevaluate) !== "allow") continue
            pending.delete(id)
            yield* replied(item, "always")
            yield* Deferred.succeed(item.deferred, undefined)
          }
        }),
      ),
    )

    const list = Effect.fn("PermissionLedger.list")(function* (location?: Location.Ref) {
      return Array.from(pending.values())
        .filter(
          (item) =>
            !location ||
            (item.location.directory === location.directory && item.location.workspaceID === location.workspaceID),
        )
        .map((item) => item.request)
    })

    const get = Effect.fn("PermissionLedger.get")(function* (id: Permission.ID) {
      return pending.get(id)?.request
    })

    const forSession = Effect.fn("PermissionLedger.forSession")(function* (sessionID: SessionSchema.ID) {
      return Array.from(pending.values(), (item) => item.request).filter((request) => request.sessionID === sessionID)
    })

    return Service.of({ register, reply, get, forSession, list })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [Bus.node, PermissionSaved.node] })
