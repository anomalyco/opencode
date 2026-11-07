import { describe, expect, test } from "bun:test"
import { Effect, Logger } from "effect"
import { AppNodeBuilder } from "@Mackery6969/core/effect/app-node-builder"
import { LayerNode } from "@Mackery6969/util/effect/layer-node"
import { Database } from "@Mackery6969/core/database/database"
import { Bus } from "@Mackery6969/core/bus"
import { EventLogger } from "@Mackery6969/core/event-logger"
import { Agent } from "@Mackery6969/schema/agent"
import { Model } from "@Mackery6969/schema/model"
import { Provider } from "@Mackery6969/schema/provider"
import { Command } from "@Mackery6969/schema/command"
import { Config } from "@Mackery6969/schema/config"
import { McpEvent } from "@Mackery6969/schema/mcp-event"

const UnlistedUpdated = Bus.ephemeral({ type: "test.updated", schema: {} })

describe("EventLogger", () => {
  test("logs explicitly listed updated events", async () => {
    const output = new Array<ReturnType<typeof Logger.formatStructured.log>>()
    const logger = Logger.map(Logger.formatStructured, (entry) => {
      output.push(entry)
    })

    await Effect.gen(function* () {
      const bus = yield* Bus.Service
      yield* bus.publish(Agent.Event.Updated, {})
      yield* bus.publish(Provider.Event.Updated, {})
      yield* bus.publish(Model.Event.Updated, {})
      yield* bus.publish(Command.Event.Updated, {})
      yield* bus.publish(Config.Event.Updated, {})
      yield* bus.publish(McpEvent.StatusChanged, { server: "example" })
      yield* bus.publish(UnlistedUpdated, {})
    }).pipe(
      Effect.provide(AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, EventLogger.node]))),
      Effect.provide(Logger.layer([logger])),
      Effect.scoped,
      Effect.runPromise,
    )

    expect(
      output.flatMap((entry) => (Array.isArray(entry.message) && entry.message[0] === "event" ? [entry.message] : [])),
    ).toEqual([
      ["event", { event: expect.objectContaining({ type: "agent.updated" }) }],
      ["event", { event: expect.objectContaining({ type: "provider.updated" }) }],
      ["event", { event: expect.objectContaining({ type: "model.updated" }) }],
      ["event", { event: expect.objectContaining({ type: "command.updated" }) }],
      ["event", { event: expect.objectContaining({ type: "config.updated" }) }],
    ])
  })
})
