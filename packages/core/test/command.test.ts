import { describe, expect } from "bun:test"
import { Effect, Fiber, Stream } from "effect"
import { CommandV2 } from "@opencode-ai/core/command"
import { Config } from "@opencode-ai/core/config"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { EventV2 } from "@opencode-ai/core/event"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Location } from "@opencode-ai/core/location"
import { MCP } from "@opencode-ai/core/mcp/index"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { emptyConfigLayer, emptyMcpLayer, testLocationLayer } from "./fixture/mcp"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([CommandV2.node, EventV2.node]), [
    [MCP.node, emptyMcpLayer],
    [Config.node, emptyConfigLayer],
    [Location.node, testLocationLayer],
  ]),
)

describe("CommandV2", () => {
  it.effect("publishes an updated event after command changes are visible", () =>
    Effect.gen(function* () {
      const command = yield* CommandV2.Service
      const events = yield* EventV2.Service
      const updated = yield* events
        .subscribe(CommandV2.Event.Updated)
        .pipe(Stream.take(1), Stream.runHead, Effect.andThen(command.get("review")), Effect.forkScoped)
      yield* Effect.yieldNow

      yield* command.transform((editor) => editor.update("review", (item) => (item.template = "Review")))

      expect(yield* Fiber.join(updated)).toMatchObject({ name: "review", template: "Review" })
    }),
  )

  it.effect("applies command transforms and preserves later overrides", () =>
    Effect.gen(function* () {
      const command = yield* CommandV2.Service
      yield* command.transform((editor) => {
        editor.update("review", (command) => {
          command.template = "First"
          command.description = "Review code"
        })
        editor.update("review", (command) => {
          command.template = "Second"
          command.model = {
            id: ModelV2.ID.make("claude"),
            providerID: ProviderV2.ID.make("anthropic"),
            variant: ModelV2.VariantID.make("high"),
          }
        })
      })

      expect(yield* command.get("review")).toEqual(
        CommandV2.Info.make({
          name: "review",
          template: "Second",
          description: "Review code",
          model: {
            id: ModelV2.ID.make("claude"),
            providerID: ProviderV2.ID.make("anthropic"),
            variant: ModelV2.VariantID.make("high"),
          },
        }),
      )
      expect(yield* command.list()).toEqual([
        CommandV2.Info.make({
          name: "review",
          template: "Second",
          description: "Review code",
          model: {
            id: ModelV2.ID.make("claude"),
            providerID: ProviderV2.ID.make("anthropic"),
            variant: ModelV2.VariantID.make("high"),
          },
        }),
      ])
    }),
  )

  it.effect("evaluates command template shell blocks", () =>
    Effect.gen(function* () {
      const command = yield* CommandV2.Service
      yield* command.transform((editor) => {
        editor.update("review", (command) => {
          command.template = "Output: !`echo command-output`"
        })
      })

      expect((yield* command.evaluate({ name: "review" })).text.replace(/\r?\n$/, "")).toEqual("Output: command-output")
    }),
  )
})
