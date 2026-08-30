import { OpenCode } from "@opencode-ai/client"
import type { RpcCallOptions, RpcEventPayload } from "@opencode-ai/client"
import { Rpc } from "@opencode-ai/plugin/rpc"
import type { RpcHandlers } from "@opencode-ai/plugin/promise/rpc"
import type { Plugin } from "@opencode-ai/plugin"
import type { StandardSchemaV1 } from "@standard-schema/spec"
import { z } from "zod"
import { Acme, EffectAcme } from "./rpc.fixture.js"
import type { Assert, Equal } from "./rpc.fixture.js"

const client = OpenCode.make({ baseUrl: "http://localhost" })
declare const ctx: Plugin.Context

const acme = client.rpc(Acme)
const search = acme.search({ query: "hello" })
const count = acme.count({ count: "42" })
const codec = acme.codec({ count: "42" })
const raw = acme.raw({ value: "hello" })
const ping = acme.ping()

export type Checks = [
  Assert<Equal<typeof Acme.id, "acme">>,
  Assert<Equal<keyof typeof Acme.methods, "search" | "count" | "codec" | "raw" | "ping">>,
  Assert<Equal<typeof search, Promise<{ text: string }>>>,
  Assert<Equal<typeof count, Promise<string>>>,
  Assert<Equal<typeof codec, Promise<number>>>,
  Assert<Equal<typeof raw, Promise<unknown>>>,
  Assert<Equal<typeof ping, Promise<null>>>,
  Assert<Equal<Rpc.Input<typeof Acme.methods.count.input>, { count: string }>>,
  Assert<Equal<Rpc.Output<typeof Acme.methods.count.input>, { count: number }>>,
  Assert<Equal<Rpc.HandlerOutput<typeof Acme.methods.count.output>, number>>,
  Assert<Equal<Rpc.HandlerOutput<typeof Acme.methods.codec.output>, number>>,
  Assert<Equal<Rpc.EventPayload<typeof Acme, "updated">["type"], "rpc.acme.updated">>,
  Assert<Equal<RpcEventPayload<typeof Acme, "updated">["location"], { directory: string; workspaceID?: string }>>,
  Assert<Equal<Rpc.Input<StandardSchemaV1<string, number>>, string>>,
  Assert<Equal<Rpc.Output<StandardSchemaV1<string, number>>, number>>,
  Assert<Equal<Rpc.HandlerOutput<StandardSchemaV1<string, number>>, string>>,
]

await acme.search({ query: "hello" }, { location: { directory: "/project", workspace: "workspace" } })
await acme.search({ query: "hello" }, { signal: new AbortController().signal, headers: { "x-test": "yes" } })
await acme.ping(undefined, { location: { directory: "/project" } })
await ctx.rpc(Acme).search({ query: "hello" }, { signal: new AbortController().signal })

// @ts-expect-error Native event subscriptions share base headers, not subscriber overrides.
client.event.subscribe({ headers: { authorization: "override" } })

// @ts-expect-error Query must be a string.
await acme.search({ query: 1 })
// @ts-expect-error Required method inputs cannot be omitted.
await acme.search()
// @ts-expect-error Callers supply the input representation, not the parsed value.
await acme.count({ count: 42 })
// @ts-expect-error Standard Schema callers supply the accepted input representation.
await acme.codec({ count: 42 })
// @ts-expect-error Only declared methods are callable.
await acme.missing({})
// @ts-expect-error Location is call metadata, not injected into the declared input.
await acme.search({ query: "hello", location: { directory: "/project" } })
// @ts-expect-error Plugin handles cannot select another location.
await ctx.rpc(Acme).search({ query: "hello" }, { location: { directory: "/other" } })
// @ts-expect-error Plugin handles cannot use headers to override their location either.
await ctx.rpc(Acme).search({ query: "hello" }, { headers: { "x-opencode-directory": "/other" } })

declare const remoteOptions: RpcCallOptions
// @ts-expect-error Passing options through a variable must not enable local routing overrides.
await ctx.rpc(Acme).search({ query: "hello" }, remoteOptions)

const handlers: RpcHandlers<typeof Acme> = {
  search: async (input, call) => {
    input.query satisfies string
    call.signal satisfies AbortSignal
    if (input.query === "missing")
      return call.error("not_found", "Missing", { query: input.query, attempts: "1" })
    if (input.query === "unavailable") throw call.error("unavailable", "Unavailable")
    return { text: input.query }
  },
  count: async (input) => {
    input.count satisfies number
    // @ts-expect-error Handlers receive the parsed representation.
    input.count satisfies string
    return input.count
  },
  codec: async (input) => {
    input.count satisfies number
    return input.count
  },
  raw: async (input) => {
    // @ts-expect-error Plain JSON Schema does not infer an input shape.
    input.value
    return 1
  },
  ping: async () => null,
}

// @ts-expect-error Error names must be declared by the method.
handlers.search({ query: "missing" }, { signal: AbortSignal.abort(), error: () => ({ type: "missing" }) })

// @ts-expect-error Promise clients accept portable Standard or JSON schemas, not Effect Schema.
client.rpc(EffectAcme)
// @ts-expect-error Promise plugins cannot register Effect Schema contracts.
await ctx.rpc.register(EffectAcme, { codec: async ({ count }) => count })

const registration = await ctx.rpc.register(Acme, handlers)
await registration.events.emit("updated", { itemID: "123", text: "hello" })
await registration.events.emit("progress", { percent: 50 })
await registration.events.emit("counted", { count: 42 })
await registration.dispose()

await ctx.rpc.register(Acme, {
  ...handlers,
  search: async ({ query }) => {
    query satisfies string
    return { text: query }
  },
})

// @ts-expect-error The definition cannot widen to accommodate an incorrect handler result.
await ctx.rpc.register(Acme, { ...handlers, search: async () => ({ text: 42 }) })
// @ts-expect-error Every declared method must have a handler.
await ctx.rpc.register(Acme, { search: handlers.search })
// @ts-expect-error Additional handlers are not declared by the RPC.
await ctx.rpc.register(Acme, { ...handlers, missing: async () => null })
// @ts-expect-error Promise handlers must not return synchronous values.
await ctx.rpc.register(Acme, { ...handlers, ping: () => null })
// @ts-expect-error Standard Schema output transforms consume their input type.
await ctx.rpc.register(Acme, { ...handlers, count: async () => "42" })
// @ts-expect-error Effect output codecs encode the decoded result type.
await ctx.rpc.register(Acme, { ...handlers, codec: async () => "42" })
// @ts-expect-error Event payloads must match their schema.
await registration.events.emit("updated", { itemID: 123, text: "hello" })
// @ts-expect-error Publishing accepts only declared local event names.
await registration.events.emit("missing", {})
// @ts-expect-error Publishing applies the output schema, rather than accepting its transformed result.
await registration.events.emit("counted", { count: "42" })

const unsubscribe = acme.events.on("updated", (event) => {
  event.type satisfies "rpc.acme.updated"
  event.data.text satisfies string
  event.location.directory satisfies string
  // @ts-expect-error Payloads are selected by the event name.
  event.data.percent
})
unsubscribe satisfies () => void

declare const withoutLocation: Omit<RpcEventPayload<typeof Acme, "updated">, "location">
// @ts-expect-error Custom events always carry their emitting location.
withoutLocation satisfies RpcEventPayload<typeof Acme, "updated">

for await (const event of acme.events.subscribe("counted")) {
  event.data.text satisfies string
}

declare const name: "updated" | "progress"
// @ts-expect-error A union name cannot publish a payload matching only one possible event.
await registration.events.emit(name, { percent: 50 })
declare const emission: Rpc.EventInput<typeof Acme>
await registration.events.emit(...emission)

for await (const event of acme.events.subscribe(name)) {
  if (event.type === "rpc.acme.updated") {
    event.data.text satisfies string
    continue
  }
  event.data.percent satisfies number
}

// @ts-expect-error Subscriptions use local names, not fully prefixed wire types.
acme.events.subscribe("rpc.acme.updated")
// @ts-expect-error Unknown event names are rejected by the convenience wrapper too.
acme.events.on("missing", () => {})
// @ts-expect-error Event subscriptions do not accept per-subscriber headers.
acme.events.subscribe("updated", { headers: { "x-test": "yes" } })
// @ts-expect-error Event subscriptions are not location-filtered externally.
acme.events.on("updated", () => {}, { location: { directory: "/project" } })

// @ts-expect-error Every method requires an output schema.
Rpc.define({ id: "invalid", methods: { search: { input: Acme.methods.search.input } }, events: {} })
Rpc.define({
  id: "invalid-error",
  methods: {
    search: {
      input: z.string(),
      output: z.string(),
      // @ts-expect-error Error names beginning with rpc. are reserved for framework failures.
      errors: { "rpc.internal": z.undefined() },
    },
  },
  events: {},
})
// @ts-expect-error The subclient's events member is reserved, not an RPC method.
Rpc.define({ id: "invalid", methods: { events: Acme.methods.search }, events: {} })
// @ts-expect-error Custom event data must be an object.
Rpc.define({ id: "invalid-event", methods: {}, events: { updated: { schema: z.string() } } })
// @ts-expect-error Custom event data cannot be an array.
Rpc.define({ id: "invalid-array-event", methods: {}, events: { updated: { schema: z.array(z.string()) } } })
// @ts-expect-error Plain JSON Schema events must declare an object root.
Rpc.define({ id: "invalid-json-event", methods: {}, events: { updated: { schema: { type: "string" } } } })

const LocationInput = Rpc.define({
  id: "location-input",
  methods: {
    echo: {
      input: z.object({ location: z.string() }),
      output: z.object({ location: z.string() }),
    },
  },
  events: {},
})
await client.rpc(LocationInput).echo({ location: "a plugin-defined field" }, { location: { directory: "/project" } })
