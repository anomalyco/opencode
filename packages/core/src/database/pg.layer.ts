import * as PgClientNS from "@effect/sql-pg/PgClient"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Reactivity from "effect/unstable/reactivity/Reactivity"
import * as Duration from "effect/Duration"
import { Pg } from "./pg"
import { Redacted } from "effect"

export const layer = (url: string) =>
  Layer.merge(
    PgClientNS.layer({
      url: Redacted.make(url),
      idleTimeout: Duration.seconds(20),
      connectionTTL: Duration.seconds(60),
      maxConnections: 10,
    }),
    Layer.effect(Pg.Native, Effect.succeed(null as unknown)),
  ).pipe(Layer.provide(Reactivity.layer))
