import { expect } from "bun:test"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Location } from "@opencode/core/location"
import { Rpc } from "@opencode/core/rpc"
import { AbsolutePath } from "@opencode/core/schema"
import { Effect, Layer, Schema } from "effect"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(Rpc.node, [
    Location.node.replace(Layer.succeed(Location.Service, location({ directory: AbsolutePath.make("/rpc-project") }))),
  ]),
)

// The RPC docs allow leaving out whichever side a method does not use, so each of these declares one schema only
// (#59755). Both used to reach the validator with `undefined` and fail as rpc.internal.
// A plugin declares its methods in JavaScript, where the TypeScript interface that requires both schemas does not
// apply. This is the shape such a definition arrives in, so the cast stands in for the boundary the plugin crosses.
const OneSided = {
  id: "one-sided",
  methods: {
    outputOnly: { output: Schema.Struct({ ok: Schema.Boolean }) },
    inputOnly: { input: Schema.Struct({ text: Schema.String }) },
  },
  events: {},
} as unknown as Rpc.Definition

it.effect("calls a method that declares only an output schema", () =>
  Effect.gen(function* () {
    const rpc = yield* Rpc.Service
    yield* rpc.register(OneSided, {
      outputOnly: () => Effect.succeed({ ok: true }),
      inputOnly: () => Effect.succeed(undefined),
    })

    expect(yield* rpc.call("one-sided", "outputOnly", undefined)).toEqual({ ok: true })
  }),
)

it.effect("calls a method that declares only an input schema", () =>
  Effect.gen(function* () {
    const rpc = yield* Rpc.Service
    yield* rpc.register(OneSided, {
      outputOnly: () => Effect.succeed({ ok: true }),
      inputOnly: (input) => Effect.succeed(input),
    })

    expect(yield* rpc.call("one-sided", "inputOnly", { text: "kept" })).toEqual({ text: "kept" })
  }),
)

it.effect("still rejects input the declared schema does not accept", () =>
  Effect.gen(function* () {
    const rpc = yield* Rpc.Service
    yield* rpc.register(OneSided, {
      outputOnly: () => Effect.succeed({ ok: true }),
      inputOnly: () => Effect.succeed(undefined),
    })

    const result = yield* rpc.call("one-sided", "inputOnly", { text: 42 }).pipe(Effect.flip)
    expect(result.type).toBe("rpc.invalid_input")
  }),
)
