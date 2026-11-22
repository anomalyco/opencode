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

const Status = Rpc.define({
  id: "status",
  methods: {
    ping: {},
    notify: { input: Schema.String },
  },
  events: {},
})

it.effect("calls methods that omit their input or output schema", () =>
  Effect.gen(function* () {
    const rpc = yield* Rpc.Service
    const received: string[] = []
    yield* rpc.register(Status, {
      ping: () => Effect.void,
      notify: (message) => Effect.sync(() => void received.push(message)),
    })
    const client = rpc.client(Status)
    expect(yield* client.ping()).toBeUndefined()
    expect(yield* client.notify("ready")).toBeUndefined()
    expect(received).toEqual(["ready"])
    // A method without an input schema ignores whatever an untyped caller sends.
    expect(yield* rpc.call("status", "ping", { unexpected: true })).toBeUndefined()
  }),
)
