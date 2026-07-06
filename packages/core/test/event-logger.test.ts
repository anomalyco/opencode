import { describe, expect, test } from "bun:test"
import { Effect, Layer, Logger } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { EventLogger } from "@opencode-ai/core/event-logger"
import { Agent } from "@opencode-ai/schema/agent"
import { Catalog } from "@opencode-ai/schema/catalog"
import { Command } from "@opencode-ai/schema/command"
import { Config } from "@opencode-ai/schema/config"
import { McpEvent } from "@opencode-ai/schema/mcp-event"

const UnlistedUpdated = EventV2.ephemeral({ type: "test.updated", schema: {} })

describe("EventLogger", () => {
  test("logs explicitly listed updated events", async () => {
    const output = new Array<ReturnType<typeof Logger.formatStructured.log>>()
    const logger = Logger.map(Logger.formatStructured, (entry) => {
      output.push(entry)
    })

    await Effect.gen(function* () {
      const events = yield* EventV2.Service
      yield* events.publish(Agent.Event.Updated, {})
      yield* events.publish(Catalog.Event.Updated, {})
      yield* events.publish(Command.Event.Updated, {})
      yield* events.publish(Config.Event.Updated, {})
      yield* events.publish(McpEvent.StatusChanged, { server: "example" })
      yield* events.publish(UnlistedUpdated, {})
    }).pipe(
      Effect.provide(AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node, EventLogger.node]))),
      Effect.provide(Logger.layer([logger])),
      Effect.scoped,
      Effect.runPromise,
    )

    expect(output.map((entry) => entry.message)).toEqual([
      ["event", { event: expect.objectContaining({ type: "agent.updated" }) }],
      ["event", { event: expect.objectContaining({ type: "catalog.updated" }) }],
      ["event", { event: expect.objectContaining({ type: "command.updated" }) }],
      ["event", { event: expect.objectContaining({ type: "config.updated" }) }],
    ])
  })
})
