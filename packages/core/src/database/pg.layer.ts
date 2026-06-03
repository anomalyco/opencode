import * as PgClientNS from "@effect/sql-pg/PgClient"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Reactivity from "effect/unstable/reactivity/Reactivity"
import { Pg } from "./pg"
import { Redacted } from "effect"

export const layer = (url: string) =>
  Layer.merge(
    PgClientNS.layer({
      url: Redacted.make(url),
    }),
    Layer.effect(Pg.Native, Effect.succeed(null as unknown)),
  ).pipe(Layer.provide(Reactivity.layer))
