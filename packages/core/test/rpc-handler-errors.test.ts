import { expect } from "bun:test"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Location } from "@opencode-ai/core/location"
import { Rpc } from "@opencode-ai/core/rpc"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Effect, Layer, Logger, Schema } from "effect"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(Rpc.node, [
    Location.node.replace(Layer.succeed(Location.Service, location({ directory: AbsolutePath.make("/rpc-project") }))),
  ]),
)
const Broken = Rpc.define({
  id: "broken",
  methods: {
    dies: { input: Schema.Undefined, output: Schema.String },
    throws: { input: Schema.Undefined, output: Schema.String },
    raw: { input: Schema.Undefined, output: Schema.String },
    undeclared: { input: Schema.Undefined, output: Schema.String },
    invalidError: {
      input: Schema.Undefined,
      output: Schema.String,
      errors: { known: Schema.Struct({ count: Schema.Int }) },
    },
  },
  events: {},
})

for (const method of ["dies", "throws", "raw", "undeclared", "invalidError"] as const) {
  it.effect(`recovers from ${method} through the typed rpc.internal failure`, () =>
    Effect.gen(function* () {
      const rpc = yield* Rpc.Service
      yield* rpc.register(Broken, {
        dies: () => Effect.die(new Error("handler defect")),
        throws: () => {
          throw new Error("handler threw")
        },
        // Raw Promise rejections reach this boundary as failed Effects.
        // @ts-expect-error intentionally exercise an undeclared failure
        raw: () => Effect.fail(new Error("raw failure")),
        // @ts-expect-error intentionally exercise an undeclared error name
        undeclared: (_input, context) => Effect.fail(context.error("unknown", "Unknown")),
        invalidError: (_input, context) => Effect.fail(context.error("known", "Invalid count", { count: 1.5 })),
      })
      const logged: unknown[] = []
      const result = yield* rpc
        .client(Broken)
        [method]()
        .pipe(
          Effect.catchIf(
            (error) => "type" in error && error.type === "rpc.internal",
            (error) => Effect.succeed(error),
          ),
          Effect.provideService(Logger.CurrentLoggers, new Set([Logger.make((entry) => logged.push(entry.message))])),
        )
      expect(result).toEqual({ type: "rpc.internal", message: "RPC call failed" })
      expect(logged).toHaveLength(1)
    }),
  )
}
