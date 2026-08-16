import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionBudgetEvent } from "@opencode-ai/schema/session-budget-event"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Provider } from "@/provider/provider"
import { SessionCompaction } from "@/session/compaction"
import { SessionID } from "@/session/schema"
import { testProviderConfig } from "../lib/test-provider"
import { testEffect } from "../lib/effect"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([SessionCompaction.node, Provider.node, EventV2Bridge.node])),
)

const config = () => testProviderConfig("http://localhost:1/v1")

const tokens = (input: number) => ({ input, output: 1_000, reasoning: 0, cache: { read: 0, write: 0 } })

describe("session budget events", () => {
  // test-model fixture: limit.context 100_000, limit.output 10_000 → the
  // usable window is 90_000 and the proportional reserve is 15_000.
  it.instance(
    "overflow gate emits session.overflow.detected on the bus",
    () =>
      Effect.gen(function* () {
        const compaction = yield* SessionCompaction.Service
        const provider = yield* Provider.Service
        const events = yield* EventV2Bridge.Service
        const model = yield* provider.getModel(ProviderV2.ID.make("test"), ModelV2.ID.make("test-model"))
        const sessionID = SessionID.make("ses_budget-overflow")

        const seen: (typeof SessionBudgetEvent.OverflowDetected.data.Type)[] = []
        const off = yield* events.listen((event) => {
          if (event.type !== SessionBudgetEvent.OverflowDetected.type) return Effect.void
          seen.push(event.data as typeof SessionBudgetEvent.OverflowDetected.data.Type)
          return Effect.void
        })

        expect(yield* compaction.isOverflow({ tokens: tokens(10_000), model, sessionID })).toBe(false)
        expect(seen).toHaveLength(0)

        expect(yield* compaction.isOverflow({ tokens: tokens(95_000), model, sessionID })).toBe(true)
        yield* off

        expect(seen).toHaveLength(1)
        expect(seen[0]).toMatchObject({
          sessionID,
          tokens: 96_000,
          usable: 90_000,
          reserve: 15_000,
          action: "compact",
        })
      }),
    { config },
  )
})
