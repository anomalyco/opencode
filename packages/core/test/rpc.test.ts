import { describe, expect } from "bun:test"
import { Bus } from "@opencode-ai/core/bus"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Location } from "@opencode-ai/core/location"
import { Rpc } from "@opencode-ai/core/rpc"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Workspace } from "@opencode-ai/core/workspace"
import type { Event } from "@opencode-ai/schema/event"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Cause, Context, Deferred, Effect, Exit, Fiber, Layer, Schema, Scope, Stream } from "effect"
import { z } from "zod"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"

const ref = Location.Ref.make({ directory: AbsolutePath.make("/rpc-project") })
const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Rpc.node, Bus.node, Location.node]), [
    [Location.node, Layer.succeed(Location.Service, location(ref))],
  ]),
)
const Echo = Rpc.define({
  id: "test.rpc",
  methods: { echo: { input: z.string(), output: z.string() } },
  events: { updated: { schema: z.object({ text: z.string() }) } },
})

describe("Rpc", () => {
  it.effect("creates handles before registration and resolves on every execution", () =>
    Effect.gen(function* () {
      const rpc = yield* Rpc.Service
      const client = rpc.client(Echo)
      const request = client.echo("hello")
      expect(yield* request.pipe(Effect.flip)).toEqual({
        type: "rpc.unavailable",
        message: "RPC is unavailable: test.rpc",
      })

      yield* rpc.register(Echo, { echo: (value) => Effect.succeed(value) })
      expect(yield* request).toBe("hello")
      yield* rpc.register(Echo, { echo: (value) => Effect.succeed(`${value}!`) })
      expect(yield* request).toBe("hello!")
      expect(yield* rpc.call(Echo.id, "missing", "hello").pipe(Effect.flip)).toEqual({
        type: "rpc.method_not_found",
        message: "Unknown RPC method: test.rpc.missing",
      })
      expect(yield* rpc.call(Echo.id, "toString", "hello").pipe(Effect.flip)).toEqual({
        type: "rpc.method_not_found",
        message: "Unknown RPC method: test.rpc.toString",
      })
    }),
  )

  it.effect("uses the latest whole registration and reveals previous implementations on disposal", () =>
    Effect.gen(function* () {
      const rpc = yield* Rpc.Service
      const client = rpc.client(Echo)
      const first = yield* rpc.register(Echo, { echo: () => Effect.succeed("first") })
      const second = yield* rpc.register(Echo, { echo: () => Effect.succeed("second") })
      const third = yield* rpc.register(Echo, { echo: () => Effect.succeed("third") })
      expect(yield* client.echo("hello")).toBe("third")
      yield* second.dispose
      expect(yield* client.echo("hello")).toBe("third")
      yield* third.dispose
      expect(yield* client.echo("hello")).toBe("first")
      yield* third.dispose
      expect(yield* client.echo("hello")).toBe("first")
      yield* first.dispose
      expect(Exit.isFailure(yield* client.echo("hello").pipe(Effect.exit))).toBe(true)
    }),
  )

  it.effect("removes registrations when their owning scope closes", () =>
    Effect.gen(function* () {
      const rpc = yield* Rpc.Service
      yield* rpc.register(Echo, { echo: () => Effect.succeed("original") })
      const scope = yield* Scope.make()
      yield* rpc.register(Echo, { echo: () => Effect.succeed("override") }).pipe(Scope.provide(scope))
      expect(yield* rpc.client(Echo).echo("hello")).toBe("override")
      yield* Scope.close(scope, Exit.void)
      expect(yield* rpc.client(Echo).echo("hello")).toBe("original")
    }),
  )

  it.effect("validates inputs before running handlers and validates returned results", () =>
    Effect.gen(function* () {
      const rpc = yield* Rpc.Service
      const received: string[] = []
      yield* rpc.register(Echo, {
        echo: (value) =>
          Effect.sync(() => {
            received.push(value)
            return value
          }),
      })
      expect(Exit.isFailure(yield* rpc.call(Echo.id, "echo", 42).pipe(Effect.exit))).toBe(true)
      expect(received).toEqual([])

      const Checked = Rpc.define({
        id: "checked",
        methods: { echo: { input: z.string(), output: z.string().min(3) } },
        events: {},
      })
      yield* rpc.register(Checked, { echo: () => Effect.succeed("a") })
      expect(Exit.isFailure(yield* rpc.client(Checked).echo("hello").pipe(Effect.exit))).toBe(true)
    }),
  )

  it.effect("leaves local transport values to the declared schema", () =>
    Effect.gen(function* () {
      const rpc = yield* Rpc.Service
      const Identity = Rpc.define({
        id: "identity",
        methods: { echo: { input: Schema.Unknown, output: Schema.Unknown } },
        events: {},
      })
      yield* rpc.register(Identity, { echo: Effect.succeed })
      const value = new Date(0)
      expect(yield* rpc.client(Identity).echo(value)).toBe(value)
    }),
  )

  it.effect("applies Standard Schema transforms once for inputs, outputs, and events", () =>
    Effect.gen(function* () {
      const rpc = yield* Rpc.Service
      const counts = { input: 0, output: 0, event: 0 }
      const Transformed = Rpc.define({
        id: "transformed",
        methods: {
          count: {
            input: z.string().transform((value) => {
              counts.input++
              return Number(value)
            }),
            output: z.number().transform((value) => {
              counts.output++
              return String(value)
            }),
          },
        },
        events: {
          counted: {
            schema: z.object({ count: z.number() }).transform(({ count }) => {
              counts.event++
              return { text: String(count) }
            }),
          },
        },
      })
      const registration = yield* rpc.register(Transformed, { count: (value) => Effect.succeed(value + 1) })
      const client = rpc.client(Transformed)
      expect(yield* client.count("41")).toBe("42")
      const events = yield* client.events
        .subscribe("counted")
        .pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
      yield* Effect.yieldNow
      yield* registration.events.emit("counted", { count: 42 })
      expect((yield* Fiber.join(events))[0].data).toEqual({ text: "42" })
      expect(counts).toEqual({ input: 1, output: 1, event: 1 })
    }),
  )

  it.effect("keeps encoded dispatch and decoded local results consistent for Effect codecs", () =>
    Effect.gen(function* () {
      const rpc = yield* Rpc.Service
      const Codec = Rpc.define({
        id: "codec",
        methods: { count: { input: Schema.FiniteFromString, output: Schema.FiniteFromString } },
        events: { counted: { schema: Schema.Struct({ count: Schema.FiniteFromString }) } },
      })
      const registration = yield* rpc.register(Codec, { count: (value) => Effect.succeed(value + 1) })
      expect(yield* rpc.call(Codec.id, "count", "41")).toBe("42")
      expect(yield* rpc.client(Codec).count("41")).toBe(42)
      const events = yield* rpc
        .client(Codec)
        .events.subscribe("counted")
        .pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
      yield* Effect.yieldNow
      yield* registration.events.emit("counted", { count: 42 })
      expect((yield* Fiber.join(events))[0].data).toEqual({ count: 42 })
    }),
  )

  it.effect("validates declared error data and decodes it for local clients", () =>
    Effect.gen(function* () {
      const rpc = yield* Rpc.Service
      const Failing = Rpc.define({
        id: "failing",
        methods: {
          standard: {
            input: z.undefined(),
            output: z.string(),
            errors: { missing: z.object({ attempts: z.string().transform(Number) }) },
          },
          effect: {
            input: Schema.Undefined,
            output: Schema.String,
            errors: { invalid: Schema.Struct({ count: Schema.FiniteFromString }) },
          },
        },
        events: {},
      })
      yield* rpc.register(Failing, {
        standard: (_input, context) =>
          Effect.fail(context.error("missing", "Missing", { attempts: "2" })),
        effect: (_input, context) => Effect.fail(context.error("invalid", "Invalid", { count: 3 })),
      })

      expect(yield* rpc.call(Failing.id, "standard", undefined).pipe(Effect.flip)).toEqual({
        type: "missing",
        message: "Missing",
        data: { attempts: 2 },
      })
      expect(yield* rpc.client(Failing).standard().pipe(Effect.flip)).toEqual({
        type: "missing",
        message: "Missing",
        data: { attempts: 2 },
      })
      expect(yield* rpc.call(Failing.id, "effect", undefined).pipe(Effect.flip)).toEqual({
        type: "invalid",
        message: "Invalid",
        data: { count: "3" },
      })
      expect(yield* rpc.client(Failing).effect().pipe(Effect.flip)).toEqual({
        type: "invalid",
        message: "Invalid",
        data: { count: 3 },
      })
    }),
  )

  it.effect("keeps other event consumers running after one subscription ends", () =>
    Effect.gen(function* () {
      const rpc = yield* Rpc.Service
      const registration = yield* rpc.register(Echo, { echo: (value) => Effect.succeed(value) })
      const client = rpc.client(Echo)
      const first = yield* client.events.subscribe("updated").pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
      const second = yield* client.events
        .subscribe("updated")
        .pipe(Stream.take(2), Stream.runCollect, Effect.forkScoped)
      yield* Effect.yieldNow
      yield* registration.events.emit("updated", { text: "first" })
      const received = yield* Fiber.join(first)
      expect(received.map((event) => event.data.text)).toEqual(["first"])
      Reflect.set(received[0].location, "directory", "/consumer-mutated")
      yield* registration.events.emit("updated", { text: "second" })
      expect((yield* Fiber.join(second)).map((event) => event.data.text)).toEqual(["first", "second"])
    }),
  )

  it.effect("validates plain JSON Schema inputs and outputs without type inference", () =>
    Effect.gen(function* () {
      const rpc = yield* Rpc.Service
      const Raw = Rpc.define({
        id: "raw",
        methods: { count: { input: { type: "integer", minimum: 0 }, output: { type: "integer", minimum: 1 } } },
        events: {
          counted: {
            schema: {
              type: "object",
              properties: { count: { type: "integer", minimum: 1 } },
              required: ["count"],
              additionalProperties: false,
            },
          },
        },
      })
      const registration = yield* rpc.register(Raw, { count: (value) => Effect.succeed(value) })
      expect(yield* rpc.call(Raw.id, "count", 42)).toBe(42)
      expect(Exit.isFailure(yield* rpc.call(Raw.id, "count", "42").pipe(Effect.exit))).toBe(true)
      expect(Exit.isFailure(yield* rpc.call(Raw.id, "count", 0).pipe(Effect.exit))).toBe(true)
      expect(Exit.isFailure(yield* registration.events.emit("counted", { count: 0 }).pipe(Effect.exit))).toBe(true)

    }),
  )

  it.effect("supports methods with no input and no returned value", () =>
    Effect.gen(function* () {
      const rpc = yield* Rpc.Service
      const Empty = Rpc.define({
        id: "empty",
        methods: { ping: { input: z.undefined(), output: z.undefined() } },
        events: {},
      })
      yield* rpc.register(Empty, { ping: () => Effect.undefined })
      expect(yield* rpc.client(Empty).ping()).toBeUndefined()
    }),
  )

  it.effect("keeps in-flight calls on their original implementation after removal", () =>
    Effect.gen(function* () {
      const rpc = yield* Rpc.Service
      const started = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const registration = yield* rpc.register(Echo, {
        echo: (value) =>
          Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(release)), Effect.as(value)),
      })
      const call = yield* rpc.client(Echo).echo("original").pipe(Effect.forkScoped)
      yield* Deferred.await(started)
      yield* registration.dispose
      yield* rpc.register(Echo, { echo: () => Effect.succeed("replacement") })
      expect(yield* rpc.client(Echo).echo("hello")).toBe("replacement")
      yield* Deferred.succeed(release, undefined)
      expect(yield* Fiber.join(call)).toBe("original")
    }),
  )

  it.effect("interrupts the running Effect handler when its call is cancelled", () =>
    Effect.gen(function* () {
      const rpc = yield* Rpc.Service
      const started = yield* Deferred.make<void>()
      const stopped = yield* Deferred.make<void>()
      yield* rpc.register(Echo, {
        echo: () =>
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() => Deferred.succeed(stopped, undefined)),
          ),
      })
      const call = yield* rpc.client(Echo).echo("hello").pipe(Effect.forkScoped)
      yield* Deferred.await(started)
      yield* Fiber.interrupt(call)
      yield* Deferred.await(stopped)
    }),
  )

  it.effect("isolates registrations and subscriptions while publishing location-tagged events on the shared bus", () =>
    Effect.gen(function* () {
      const rpc = yield* Rpc.Service
      const bus = yield* Bus.Service
      const otherRef = Location.Ref.make({ directory: ref.directory, workspaceID: Workspace.ID.make("wrk_other") })
      const otherContext = yield* Layer.build(
        LayerNode.compile(Rpc.node, [
          [Bus.node, Layer.succeed(Bus.Service, bus)],
          [Location.node, Layer.succeed(Location.Service, location(otherRef))],
        ]).pipe(Layer.fresh),
      )
      const other = Context.get(otherContext, Rpc.Service)
      const first = yield* rpc.register(Echo, { echo: () => Effect.succeed("first") })
      expect(Exit.isFailure(yield* other.client(Echo).echo("hello").pipe(Effect.exit))).toBe(true)
      const second = yield* other.register(Echo, { echo: () => Effect.succeed("second") })
      expect(yield* rpc.client(Echo).echo("hello")).toBe("first")
      expect(yield* other.client(Echo).echo("hello")).toBe("second")

      const all: Event.Payload[] = []
      const unsubscribe = yield* bus.listen((event) =>
        Effect.sync(() => {
          all.push(event)
        }),
      )
      const localEvents = yield* rpc
        .client(Echo)
        .events.subscribe("updated")
        .pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
      const otherEvents = yield* other
        .client(Echo)
        .events.subscribe("updated")
        .pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
      yield* Effect.yieldNow
      yield* second.events.emit("updated", { text: "second" })
      yield* first.events
        .emit("updated", { text: "first" })
        .pipe(Effect.provideService(Location.Service, location(otherRef)))
      expect((yield* Fiber.join(localEvents))[0]).toMatchObject({
        type: "rpc.test.rpc.updated",
        data: { text: "first" },
        location: ref,
      })
      expect((yield* Fiber.join(otherEvents))[0]).toMatchObject({
        type: "rpc.test.rpc.updated",
        data: { text: "second" },
        location: otherRef,
      })
      expect(all.map((event) => event.location)).toEqual([otherRef, ref])
      yield* unsubscribe
    }),
  )
})
