export * as ProfilerContextSource from "./profiler"

import { Effect, Layer, Schema } from "effect"
import { makeLocationNode } from "../../effect/app-node"
import { SessionProfiler } from "../../session/profiler"
import { SystemContext } from "../index"
import { SystemContextRegistry } from "../registry"

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const registry = yield* SystemContextRegistry.Service
    const profiler = yield* SessionProfiler.Service

    yield* registry.register({
      key: SystemContext.Key.make("core/profiler"),
      load: Effect.gen(function* () {
        const insights = yield* profiler.getInsights("profiler:")
        if (insights.length === 0) return SystemContext.empty
        const lines = insights.map((i) => `[${i.severity}] ${i.metric}: ${i.suggestion}`)
        return SystemContext.combine([
          SystemContext.make({
            key: SystemContext.Key.make("core/profiler"),
            codec: Schema.toCodecJson(Schema.String),
            load: Effect.succeed(lines.join("\n")),
            baseline: (text) =>
              text.length > 0 ? `<profile-insights>\n${text}\n</profile-insights>` : "",
            update: (_prev, text) =>
              text.length > 0 ? `<profile-insights>\n${text}\n</profile-insights>` : "",
          }),
        ])
      }),
    })
  }),
)

export const node = makeLocationNode({
  name: "profiler-context",
  layer,
  deps: [SystemContextRegistry.node, SessionProfiler.node],
})
