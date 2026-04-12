import { makeRuntime } from "@/effect/run-service"
import { Session } from "@/session"
import { SessionID } from "@/session/schema"
import { SyncEvent } from "@/sync"
import { fn } from "@/util/fn"
import { Effect, Layer, Scope, Context } from "effect"
import { Config } from "../config/config"
import { Flag } from "../flag/flag"
import { ShareNext } from "./share-next"

export namespace SessionShare {
  export interface Interface {
    readonly create: (input?: Parameters<typeof Session.create>[0]) => Effect.Effect<Session.Info>
    readonly share: (sessionID: SessionID) => Effect.Effect<{ url: string }, unknown>
    readonly unshare: (sessionID: SessionID) => Effect.Effect<void, unknown>
  }

  export class Service extends Context.Service<Service, Interface>()("@opencode/SessionShare") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const cfg = yield* Config.Service
      const session = yield* Session.Service
      const shareNext = yield* ShareNext.Service
      const scope = yield* Scope.Scope

      const share = Effect.fn("SessionShare.share")(function* (sessionID: SessionID) {
        const conf = yield* cfg.get()
        if (conf.share === "disabled") throw new Error("Sharing is disabled in configuration")
        const result = yield* shareNext.create(sessionID)
        yield* Effect.sync(() =>
          SyncEvent.run(Session.Event.Updated, { sessionID, info: { share: { url: result.url } } }),
        )
        return result
      })

      const unshare = Effect.fn("SessionShare.unshare")(function* (sessionID: SessionID) {
        yield* shareNext.remove(sessionID)
        yield* Effect.sync(() => SyncEvent.run(Session.Event.Updated, { sessionID, info: { share: { url: null } } }))
      })

      const create = Effect.fn("SessionShare.create")(function* (input?: Parameters<typeof Session.create>[0]) {
        const result = yield* session.create(input)
        if (result.parentID) return result
        const conf = yield* cfg.get()
        if (!(Flag.OPENCODE_AUTO_SHARE || conf.share === "auto")) return result
        yield* share(result.id).pipe(Effect.ignore, Effect.forkIn(scope))
        return result
      })

      return Service.of({ create, share, unshare })
    }),
  )

  export const defaultLayer = layer.pipe(
    Layer.provide(ShareNext.defaultLayer),
    Layer.provide(Session.defaultLayer),
    Layer.provide(Config.defaultLayer),
  )

  const { runPromise } = makeRuntime(Service, defaultLayer)

  export const create = fn(Session.create.schema, (input) => runPromise((svc) => svc.create(input)))
  export const share = fn(SessionID.zod, (sessionID) => runPromise((svc) => svc.share(sessionID)))
  export const unshare = fn(SessionID.zod, (sessionID) => runPromise((svc) => svc.unshare(sessionID)))
}
