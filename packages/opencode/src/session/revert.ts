import z from "zod"
import { Effect, Layer, ServiceMap } from "effect"
import { makeRuntime } from "@/effect/run-service"
import { Bus } from "../bus"
import { Snapshot } from "../snapshot"
import { Storage } from "@/storage/storage"
import { SyncEvent } from "../sync"
import { Log } from "../util/log"
import { Session } from "."
import { MessageV2 } from "./message-v2"
import { SessionID, MessageID, PartID } from "./schema"
import { SessionPrompt } from "./prompt"
import { SessionSummary } from "./summary"

export namespace SessionRevert {
  const log = Log.create({ service: "session.revert" })

  export const RevertInput = z.object({
    sessionID: SessionID.zod,
    messageID: MessageID.zod,
    partID: PartID.zod.optional(),
  })
  export type RevertInput = z.infer<typeof RevertInput>

  export interface Interface {
    readonly revert: (input: RevertInput) => Effect.Effect<Session.Info>
    readonly unrevert: (input: { sessionID: SessionID }) => Effect.Effect<Session.Info>
    readonly cleanup: (session: Session.Info) => Effect.Effect<void>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/SessionRevert") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const snap = yield* Snapshot.Service
      const storage = yield* Storage.Service
      const bus = yield* Bus.Service
      const summary = yield* SessionSummary.Service

      const revert = Effect.fn("SessionRevert.revert")(function* (input: RevertInput) {
        yield* Effect.promise(() => SessionPrompt.assertNotBusy(input.sessionID))
        const all = yield* sessions.messages({ sessionID: input.sessionID })
        let lastUser: MessageV2.User | undefined
        const session = yield* sessions.get(input.sessionID)

        let rev: Session.Info["revert"]
        const patches: Snapshot.Patch[] = []
        for (const msg of all) {
          if (msg.info.role === "user") lastUser = msg.info
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
        yield* snap.revert(patches)
        if (rev.snapshot) rev.diff = yield* snap.diff(rev.snapshot as string)
        const range = all.filter((msg) => msg.info.id >= rev!.messageID)
        const diffs = yield* summary.computeDiff({ messages: range })
        yield* storage.write(["session_diff", input.sessionID], diffs).pipe(Effect.ignore)
        yield* bus.publish(Session.Event.Diff, { sessionID: input.sessionID, diff: diffs })
        yield* sessions.setRevert({
          sessionID: input.sessionID,
          revert: rev,
          summary: {
            additions: diffs.reduce((sum, x) => sum + x.additions, 0),
            deletions: diffs.reduce((sum, x) => sum + x.deletions, 0),
            files: diffs.length,
          },
        })
        return yield* sessions.get(input.sessionID)
      })

      const unrevert = Effect.fn("SessionRevert.unrevert")(function* (input: { sessionID: SessionID }) {
        log.info("unreverting", input)
        yield* Effect.promise(() => SessionPrompt.assertNotBusy(input.sessionID))
        const session = yield* sessions.get(input.sessionID)
        if (!session.revert) return session
        if (session.revert.snapshot) yield* snap.restore(session.revert!.snapshot!)
        yield* sessions.clearRevert(input.sessionID)
        return yield* sessions.get(input.sessionID)
      })

      const cleanup = Effect.fn("SessionRevert.cleanup")(function* (session: Session.Info) {
        if (!session.revert) return
        const sessionID = session.id
        const msgs = yield* sessions.messages({ sessionID })
        const messageID = session.revert.messageID
        const remove = [] as MessageV2.WithParts[]
        let target: MessageV2.WithParts | undefined
        for (const msg of msgs) {
          if (msg.info.id < messageID) continue
          if (msg.info.id > messageID) {
            remove.push(msg)
            continue
          }
          if (session.revert.partID) {
            target = msg
            continue
          }
          remove.push(msg)
        }
        for (const msg of remove) {
          SyncEvent.run(MessageV2.Event.Removed, {
            sessionID,
            messageID: msg.info.id,
          })
        }
        if (session.revert.partID && target) {
          const partID = session.revert.partID
          const idx = target.parts.findIndex((part) => part.id === partID)
          if (idx >= 0) {
            const removeParts = target.parts.slice(idx)
            target.parts = target.parts.slice(0, idx)
            for (const part of removeParts) {
              SyncEvent.run(MessageV2.Event.PartRemoved, {
                sessionID,
                messageID: target.info.id,
                partID: part.id,
              })
            }
          }
        }
        yield* sessions.clearRevert(sessionID)
      })

      return Service.of({ revert, unrevert, cleanup })
    }),
  )

  export const defaultLayer = Layer.unwrap(
    Effect.sync(() =>
      layer.pipe(
        Layer.provide(Session.defaultLayer),
        Layer.provide(Snapshot.defaultLayer),
        Layer.provide(Storage.defaultLayer),
        Layer.provide(Bus.layer),
        Layer.provide(SessionSummary.defaultLayer),
      ),
    ),
  )

  const { runPromise } = makeRuntime(Service, defaultLayer)

  export async function revert(input: RevertInput) {
    return runPromise((svc) => svc.revert(input))
  }

  export async function unrevert(input: { sessionID: SessionID }) {
    return runPromise((svc) => svc.unrevert(input))
  }

  export async function cleanup(session: Session.Info) {
    return runPromise((svc) => svc.cleanup(session))
  }
}
