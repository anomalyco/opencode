export * as KnowledgeContextSource from "./knowledge"

import { Effect, Layer, Schema } from "effect"
import { makeLocationNode } from "../../effect/app-node"
import { SessionKnowledge } from "../../session/knowledge"
import { SystemContext } from "../index"
import { SystemContextRegistry } from "../registry"

const knowledgeSource = SystemContext.make({
  key: SystemContext.Key.make("session/knowledge-summary"),
  codec: Schema.toCodecJson(Schema.String),
  load: Effect.succeed(""),
  baseline: () => "",
  update: (_prev, _curr) => "",
})

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const registry = yield* SystemContextRegistry.Service
    const knowledge = yield* SessionKnowledge.Service
    yield* registry.register({
      key: SystemContext.Key.make("session/knowledge-summary"),
      load: Effect.succeed(knowledgeSource),
    })
  }),
)

export const node = makeLocationNode({
  name: "knowledge-context",
  layer,
  deps: [SystemContextRegistry.node, SessionKnowledge.node],
})
