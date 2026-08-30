import { expect } from "bun:test"
import { Plugin } from "@opencode-ai/core/plugin"
import { Rpc } from "@opencode-ai/core/rpc"
import { Bus } from "@opencode-ai/core/bus"
import { Location } from "@opencode-ai/core/location"
import { PluginTestLayer } from "./fixture"
import { Effect, Exit, Schema } from "effect"
import { testEffect } from "../lib/effect"

const it = testEffect(PluginTestLayer)
const Echo = Rpc.define({
  id: "shared-echo",
  methods: {
    echo: { input: Schema.String, output: Schema.String },
    fail: {
      input: Schema.String,
      output: Schema.String,
      errors: { missing: Schema.Struct({ attempts: Schema.FiniteFromString }) },
    },
  },
  events: { updated: { schema: Schema.Struct({ text: Schema.String }) } },
})

it.effect("Effect plugins register, call, and publish RPCs independently of plugin identity", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const rpc = yield* Rpc.Service
    const bus = yield* Bus.Service
    const location = yield* Location.Service
    const events: string[] = []
    const unsubscribe = yield* bus.listen((event) =>
      Effect.sync(() => {
        if (event.type !== "rpc.shared-echo.updated") return
        expect(event.location).toEqual({ directory: location.directory })
        if (typeof event.data === "object" && event.data && "text" in event.data && typeof event.data.text === "string")
          events.push(event.data.text)
      }),
    )
    yield* plugins.activate([
      {
        id: "implementer",
        version: "1",
        effect: (ctx) =>
          Effect.gen(function* () {
            const registration = yield* ctx.rpc.register(Echo, {
              echo: (value) => Effect.succeed(`${value}!`),
              fail: (value, context) => Effect.fail(context.error("missing", "Missing", { attempts: Number(value) })),
            })
            yield* registration.events.emit("updated", { text: "ready" })
          }).pipe(Effect.orDie),
      },
      {
        id: "consumer",
        version: "1",
        effect: (ctx) =>
          Effect.gen(function* () {
            expect(yield* ctx.rpc(Echo).echo("hello")).toBe("hello!")
            expect(yield* ctx.rpc(Echo).fail("2").pipe(Effect.flip)).toEqual({
              type: "missing",
              message: "Missing",
              data: { attempts: 2 },
            })
          }).pipe(Effect.orDie),
      },
    ])
    expect(events).toEqual(["ready"])
    expect(yield* rpc.client(Echo).echo("hello")).toBe("hello!")
    yield* plugins.activate([])
    expect(Exit.isFailure(yield* rpc.client(Echo).echo("hello").pipe(Effect.exit))).toBe(true)
    yield* unsubscribe
  }),
)

it.effect("failed plugin setup removes RPC overrides and restores the previous implementation", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const rpc = yield* Rpc.Service
    yield* plugins.activate([
      {
        id: "implementer",
        version: "1",
        effect: (ctx) =>
          ctx.rpc
            .register(Echo, {
              echo: () => Effect.succeed("original"),
              fail: (_input, context) => Effect.fail(context.error("missing", "Missing", { attempts: 1 })),
            })
            .pipe(Effect.asVoid, Effect.orDie),
      },
    ])
    yield* plugins.activate([
      {
        id: "implementer",
        version: "2",
        effect: (ctx) =>
          ctx.rpc
            .register(Echo, {
              echo: () => Effect.succeed("replacement"),
              fail: (_input, context) => Effect.fail(context.error("missing", "Missing", { attempts: 1 })),
            })
            .pipe(Effect.andThen(Effect.die(new Error("setup failed"))), Effect.orDie),
      },
    ])
    expect(yield* rpc.client(Echo).echo("hello")).toBe("original")
  }),
)
