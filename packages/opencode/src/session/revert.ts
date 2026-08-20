import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Layer, Context, Schema } from "effect"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Snapshot } from "../snapshot"
import { Storage } from "@/storage/storage"
import { Session } from "./session"
import { MessageV2 } from "./message-v2"
import { SessionID, MessageID, PartID } from "./schema"
import { SessionRunState } from "./run-state"
import { SessionSummary } from "./summary"
import { SessionClosure } from "./closure/coordinator"
import { SessionMutation } from "./closure/mutation"
import { isCompleteClosurePair } from "@opencode-ai/core/session/closure-record"

export const RevertInput = Schema.Struct({
  sessionID: SessionID,
  messageID: MessageID,
  partID: Schema.optional(PartID),
})
export type RevertInput = Schema.Schema.Type<typeof RevertInput>

export interface Interface {
  readonly revert: (
    input: RevertInput,
  ) => Effect.Effect<Session.Info, Session.BusyError | Session.BoundaryError | SessionMutation.MutationRefused>
  readonly unrevert: (input: {
    sessionID: SessionID
  }) => Effect.Effect<Session.Info, Session.BusyError | SessionMutation.MutationRefused>
  readonly cleanup: (session: Session.Info) => Effect.Effect<void, SessionMutation.MutationRefused>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionRevert") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const closure = yield* SessionClosure.Service
    const snap = yield* Snapshot.Service
    const storage = yield* Storage.Service
    const events = yield* EventV2Bridge.Service
    const summary = yield* SessionSummary.Service
    const state = yield* SessionRunState.Service

    const revert = Effect.fn("SessionRevert.revert")(function* (input: RevertInput) {
      // `assertNotBusy` stays ahead of the reservation. It is a read-only precondition rather than a
      // destructive effect, so checking it first preserves the existing BusyError semantics without
      // widening the window between reserving and acting.
      yield* state.assertNotBusy(input.sessionID)
      const observed = yield* sessions.messages({ sessionID: input.sessionID }).pipe(Effect.orDie)
      const boundary = observed.find(
        (message) =>
          isCompleteClosurePair(message) &&
          (message.info.id === input.messageID || message.parts[0]?.id === input.partID),
      )
      // A branch-closure record states that a branch was stopped. Reverting to it would make the
      // record itself the boundary and delete the history it describes, so it is not a usable one.
      if (boundary)
        return yield* new Session.BoundaryError({
          operation: "revert",
          reason: "closure_record",
          sessionID: input.sessionID,
          messageID: input.messageID,
          partID: input.partID,
        })
      return yield* SessionMutation.leased(
        closure,
        { sessions: [input.sessionID], kind: "revert" },
        revertAdmitted(input),
      )
    })

    const revertAdmitted = Effect.fn("SessionRevert.revertAdmitted")(function* (input: RevertInput) {
      const all = yield* sessions.messages({ sessionID: input.sessionID }).pipe(Effect.orDie)
      let lastUser: SessionV1.User | undefined
      const session = yield* sessions.get(input.sessionID).pipe(Effect.orDie)

      let rev: Session.Info["revert"]
      const patches: Snapshot.Patch[] = []
      for (const msg of all) {
        // A closure record is synthetic evidence, not a turn the user can be returned to, so it
        // never becomes the message a part-level revert falls back to.
        if (msg.info.role === "user" && !isCompleteClosurePair(msg)) lastUser = msg.info
        const remaining = []
        for (const part of msg.parts) {
          if (rev) {
            if (part.type === "patch") patches.push(part)
            continue
          }

          if (!rev) {
            if ((msg.info.id === input.messageID && !input.partID) || part.id === input.partID) {
              const partID = remaining.some((item) => ["text", "tool"].includes(item.type)) ? input.partID : undefined
              rev = {
                messageID: !partID && lastUser ? lastUser.id : msg.info.id,
                partID,
              }
            }
            remaining.push(part)
          }
        }
      }

      if (!rev) return session

      rev.snapshot = session.revert?.snapshot ?? (yield* snap.track())
      if (session.revert?.snapshot) yield* snap.restore(session.revert.snapshot)
      yield* snap.revert(patches)
      if (rev.snapshot) rev.diff = yield* snap.diff(rev.snapshot)
      const index = all.findIndex((msg) => msg.info.id === rev.messageID)
      const range = index < 0 ? [] : all.slice(index)
      const diffs = yield* summary.computeDiff({ messages: range })
      yield* storage.write(["session_diff", input.sessionID], diffs).pipe(Effect.ignore)
      yield* events.publish(Session.Event.Diff, { sessionID: input.sessionID, diff: diffs })
      yield* sessions.setRevert({
        sessionID: input.sessionID,
        revert: rev,
        summary: {
          additions: diffs.reduce((sum, x) => sum + x.additions, 0),
          deletions: diffs.reduce((sum, x) => sum + x.deletions, 0),
          files: diffs.length,
        },
      })
      return yield* sessions.get(input.sessionID).pipe(Effect.orDie)
    })

    const unrevert = Effect.fn("SessionRevert.unrevert")(function* (input: { sessionID: SessionID }) {
      yield* Effect.logInfo("unreverting", { sessionID: input.sessionID })
      yield* state.assertNotBusy(input.sessionID)
      return yield* SessionMutation.leased(
        closure,
        { sessions: [input.sessionID], kind: "unrevert" },
        unrevertAdmitted(input),
      )
    })

    const unrevertAdmitted = Effect.fn("SessionRevert.unrevertAdmitted")(function* (input: { sessionID: SessionID }) {
      const session = yield* sessions.get(input.sessionID).pipe(Effect.orDie)
      if (!session.revert) return session
      if (session.revert.snapshot) yield* snap.restore(session.revert.snapshot)
      yield* sessions.clearRevert(input.sessionID)
      return yield* sessions.get(input.sessionID).pipe(Effect.orDie)
    })

    const cleanup = Effect.fn("SessionRevert.cleanup")(function* (session: Session.Info) {
      // No revert boundary means nothing is deleted, so there is nothing for a reservation to
      // protect. Keeping the check ahead of it avoids reserving on every ordinary prompt.
      if (!session.revert) return
      return yield* SessionMutation.leased(
        closure,
        { sessions: [session.id], kind: "revert_cleanup" },
        cleanupAdmitted(session, session.revert),
      )
    })

    // The narrowed revert is passed explicitly because moving this body behind the reservation took
    // it out of the `if (!session.revert)` narrowing above.
    const cleanupAdmitted = Effect.fn("SessionRevert.cleanupAdmitted")(function* (
      session: Session.Info,
      revert: NonNullable<Session.Info["revert"]>,
    ) {
      const sessionID = session.id
      const msgs = yield* sessions.messages({ sessionID }).pipe(Effect.orDie)
      const messageID = revert.messageID
      const index = msgs.findIndex((msg) => msg.info.id === messageID)
      const found = index < 0 ? undefined : msgs[index]
      // Closure records survive cleanup on both paths: they describe work that was stopped, and
      // deleting them would remove the only account of it while leaving the effects in place.
      const target = found && !isCompleteClosurePair(found) ? found : undefined
      const remove = (index < 0 ? [] : msgs.slice(index + (revert.partID ? 1 : 0))).filter(
        (msg) => !isCompleteClosurePair(msg),
      )
      for (const msg of remove) {
        yield* sessions.removeMessage({ sessionID, messageID: msg.info.id })
      }
      if (revert.partID && target) {
        const partID = revert.partID
        const idx = target.parts.findIndex((part) => part.id === partID)
        if (idx >= 0) {
          const removeParts = target.parts.slice(idx)
          target.parts = target.parts.slice(0, idx)
          for (const part of removeParts) {
            yield* sessions.removePart({ sessionID, messageID: target.info.id, partID: part.id })
          }
        }
      }
      yield* sessions.clearRevert(sessionID)
    })

    return Service.of({ revert, unrevert, cleanup })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [
    Session.node,
    Snapshot.node,
    Storage.node,
    EventV2Bridge.node,
    SessionSummary.node,
    SessionRunState.node,
    SessionClosure.node,
  ],
})

export * as SessionRevert from "./revert"
