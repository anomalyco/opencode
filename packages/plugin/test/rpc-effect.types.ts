import type { OpenCodeClient, RpcApi } from "@opencode-ai/client/effect"
import type { RpcHandlers, RpcRegistration } from "@opencode-ai/plugin/effect/rpc"
import type { Plugin } from "@opencode-ai/plugin/effect"
import { Rpc } from "@opencode-ai/plugin/rpc"
import { Effect, Schema, Stream } from "effect"
import type { Scope } from "effect"
import { Acme, EffectAcme } from "./rpc.fixture.js"
import type { Assert, Equal } from "./rpc.fixture.js"

declare const client: { readonly rpc: RpcApi<"transport-failure"> }
declare const ctx: Plugin.Context
declare const actualClient: OpenCodeClient
declare const name: "updated" | "progress"
declare const emission: Rpc.EventInput<typeof Acme>

const acme = client.rpc(Acme)
const search = acme.search({ query: "hello" })
const count = acme.count({ count: "42" })
const codec = acme.codec({ count: "42" })
const raw = acme.raw({ value: "hello" })
const ping = acme.ping()
const updates = acme.events.subscribe("updated")
const actualCall = actualClient.rpc(Acme).codec({ count: "42" })
const effectCall = actualClient.rpc(EffectAcme).codec({ count: "42" })
const effectUpdates = actualClient.rpc(EffectAcme).events.subscribe("progress")
const localCall = ctx.rpc(Acme).search({ query: "hello" })

export type Checks = [
  Assert<Equal<Effect.Success<typeof search>, { text: string }>>,
  Assert<
    Equal<
      Effect.Error<typeof search>,
      | "transport-failure"
      | { readonly type: "not_found"; readonly message: string; readonly data: { query: string; attempts: number } }
      | { readonly type: "unavailable"; readonly message: string; readonly data?: undefined }
    >
  >,
  Assert<Equal<Effect.Services<typeof search>, never>>,
  Assert<Equal<Effect.Success<typeof count>, string>>,
  Assert<Equal<Effect.Success<typeof codec>, number>>,
  Assert<Equal<Effect.Success<typeof raw>, unknown>>,
  Assert<Equal<Effect.Success<typeof ping>, null>>,
  Assert<Equal<Stream.Success<typeof updates>, Rpc.EventPayload<typeof Acme, "updated">>>,
  Assert<Equal<Stream.Error<typeof updates>, "transport-failure">>,
  Assert<Equal<Stream.Services<typeof updates>, never>>,
  Assert<Equal<Effect.Success<typeof actualCall>, number>>,
  Assert<Equal<Effect.Services<typeof actualCall>, never>>,
  Assert<Equal<Effect.Success<typeof effectCall>, number>>,
  Assert<Equal<Extract<Effect.Error<typeof effectCall>, Schema.SchemaError>, Schema.SchemaError>>,
  Assert<Equal<Extract<Stream.Error<typeof effectUpdates>, Schema.SchemaError>, Schema.SchemaError>>,
  Assert<
    Equal<
      Extract<Effect.Error<typeof effectCall>, { readonly type: "invalid_count" }>,
      { readonly type: "invalid_count"; readonly message: string; readonly data: { readonly count: number } }
    >
  >,
  Assert<
    Equal<
      Extract<Effect.Error<typeof localCall>, { readonly type: "not_found" }>,
      { readonly type: "not_found"; readonly message: string; readonly data: { query: string; attempts: number } }
    >
  >,
]

acme.search({ query: "hello" }, { location: { directory: "/project" } })
ctx.rpc(Acme).search({ query: "hello" })

// @ts-expect-error Effect callers supply the schema's accepted input representation too.
acme.count({ count: 42 })
// @ts-expect-error Unknown method names are rejected.
acme.missing()
// @ts-expect-error Plugin handles cannot override their location.
ctx.rpc(Acme).search({ query: "hello" }, { location: { directory: "/other" } })
// @ts-expect-error Effect event clients expose Streams, not callback convenience wrappers.
acme.events.on("updated", () => {})
// @ts-expect-error Only declared local event names can be subscribed to.
acme.events.subscribe("missing")

const handlers: RpcHandlers<typeof Acme> = {
  search: (input, context) => {
    context.error("not_found", "Missing", { query: input.query, attempts: "1" })
    context.error("unavailable", "Unavailable")
    return Effect.succeed({ text: input.query })
  },
  count: (input) => {
    input.count satisfies number
    return Effect.succeed(input.count)
  },
  codec: (input) => {
    input.count satisfies number
    return Effect.succeed(input.count)
  },
  raw: () => Effect.succeed(1),
  ping: () => Effect.succeed(null),
}

const registration = ctx.rpc.register(Acme, handlers)

export type RegistrationChecks = [
  Assert<Equal<Effect.Success<typeof registration>, RpcRegistration<typeof Acme>>>,
  Assert<Equal<Effect.Error<typeof registration>, unknown>>,
  Assert<Equal<Effect.Services<typeof registration>, Scope.Scope>>,
]

ctx.rpc.register(Acme, {
  ...handlers,
  search: (input) => {
    input.query satisfies string
    return Effect.succeed({ text: input.query })
  },
})

ctx.rpc.register(Acme, {
  ...handlers,
  search: (input, context) =>
    Effect.fail(context.error("not_found", "Missing", { query: input.query, attempts: "1" })),
})

ctx.rpc.register(Acme, {
  ...handlers,
  // @ts-expect-error Error names must be declared by the method.
  search: (_input, context) => Effect.fail(context.error("missing", "Missing", {})),
})

ctx.rpc.register(Acme, {
  ...handlers,
  search: (input, context) =>
    Effect.fail(
      context.error("not_found", "Missing", {
        query: input.query,
        // @ts-expect-error Error data uses the schema's handler-side representation.
        attempts: 1,
      }),
    ),
})

// @ts-expect-error Wrong result types cannot widen the shared definition.
ctx.rpc.register(Acme, { ...handlers, search: () => Effect.succeed({ text: 42 }) })
// @ts-expect-error Effect handlers cannot return Promises.
ctx.rpc.register(Acme, { ...handlers, search: async () => ({ text: "hello" }) })
// @ts-expect-error All declared handlers are required.
ctx.rpc.register(Acme, { search: handlers.search })

Effect.gen(function* () {
  const active = yield* registration
  yield* active.events.emit("updated", { itemID: "123", text: "hello" })
  yield* active.events.emit("counted", { count: 42 })
  yield* active.events.emit(...emission)
  yield* active.dispose
  // @ts-expect-error Published payloads are inferred from the selected event schema.
  yield* active.events.emit("progress", { percent: "50" })
  // @ts-expect-error Only local event names are accepted for publishing.
  yield* active.events.emit("rpc.acme.updated", { itemID: "123", text: "hello" })
  // @ts-expect-error A union name must stay correlated with its publishing payload.
  yield* active.events.emit(name, { percent: 50 })
})

Stream.map(updates, (event) => {
  event.type satisfies "rpc.acme.updated"
  event.location.directory satisfies string
  return event.data.text satisfies string
})

// @ts-expect-error Effect custom event data must also be an object.
Rpc.define({ id: "invalid-event", methods: {}, events: { updated: { schema: Schema.String } } })
Rpc.define({
  id: "invalid-array-event",
  methods: {},
  // @ts-expect-error Effect custom event data cannot be an array.
  events: { updated: { schema: Schema.Array(Schema.String) } },
})
