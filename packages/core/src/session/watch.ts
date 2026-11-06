export * as SessionWatch from "./watch.js"

import { Context, Effect, Layer, Schema } from "effect"
import { SessionWatch } from "@opencode/schema/session-watch"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { KeyedMutex } from "../effect/keyed-mutex.js"
import { KV } from "../kv.js"
import { SessionInbox } from "./inbox.js"
import { SessionMessage } from "./message.js"
import { SessionSchema } from "./schema.js"
import { SessionStore } from "./store.js"
import { SessionTeam } from "./team.js"

export class Error extends Schema.TaggedError<Error>()("SessionWatch.Error", { message: Schema.String }) {}

export class Service extends Context.Service<
  Service,
  {
    readonly get: (sessionID: SessionSchema.ID) => Effect.Effect<SessionWatch.Info | null>
    readonly save: (sessionID: SessionSchema.ID, input: SessionWatch.Input) => Effect.Effect<SessionWatch.Info, Error>
    readonly remove: (sessionID: SessionSchema.ID) => Effect.Effect<void>
    readonly stopped: (sessionID: SessionSchema.ID) => Effect.Effect<readonly SessionSchema.ID[]>
  }
>()("@opencode/SessionWatch") {}

const key = "session.watches"
const decode = Schema.decodeUnknownSync(Schema.Array(SessionWatch.Info))

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const kv = yield* KV.Service
    const store = yield* SessionStore.Service
    const inbox = yield* SessionInbox.Service
    const teams = yield* SessionTeam.Service
    const lock = KeyedMutex.makeUnsafe<string>().withLock(key)
    const read = () => kv.get(key).pipe(Effect.map((value) => decode(value ?? [])))
    return Service.of({
      get: (sessionID) =>
        read().pipe(Effect.map((entries) => entries.find((entry) => entry.sessionID === sessionID) ?? null)),
      save: (sessionID, input) =>
        lock(
          Effect.gen(function* () {
            const members = [...new Set(input.members)]
            if (members.includes(sessionID)) return yield* new Error({ message: "通知先自身は接続できません。" })
            for (const id of [sessionID, ...members]) {
              if (!(yield* store.get(id))) return yield* new Error({ message: `Session not found: ${id}` })
            }
            const entry = { ...input, members, sessionID }
            yield* kv.set(key, [...(yield* read()).filter((item) => item.sessionID !== sessionID), entry])
            return entry
          }),
        ),
      remove: (sessionID) =>
        lock(
          Effect.gen(function* () {
            yield* kv.set(
              key,
              (yield* read()).filter((entry) => entry.sessionID !== sessionID),
            )
          }),
        ),
      stopped: (sessionID) =>
        Effect.gen(function* () {
          const entries = (yield* read()).filter((entry) => entry.enabled && entry.members.includes(sessionID))
          if (entries.length === 0) return []
          const member = yield* store.get(sessionID)
          if (!member) return []
          const membership = yield* teams.membership(sessionID)
          const name = membership?.name ?? member.title ?? sessionID
          const targets = yield* Effect.forEach(entries, (entry) =>
            Effect.gen(function* () {
              if (!(yield* store.get(entry.sessionID))) return undefined
              yield* inbox
                .admit({
                  sessionID: entry.sessionID,
                  id: SessionMessage.ID.create(),
                  item: {
                    type: "user",
                    delivery: "steer",
                    payload: {
                      text: entry.text.replaceAll("{member}", name),
                      metadata: { stoppedMemberID: sessionID },
                    },
                  },
                })
                .pipe(Effect.orDie)
              return entry.sessionID
            }),
          )
          return targets.filter((target) => target !== undefined)
        }),
    })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [KV.node, SessionStore.node, SessionInbox.node, SessionTeam.node],
})
