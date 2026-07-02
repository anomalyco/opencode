import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { CommandV2 } from "@opencode-ai/core/command"
import { Config } from "@opencode-ai/core/config"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Location } from "@opencode-ai/core/location"
import { MCP } from "@opencode-ai/core/mcp/index"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { emptyConfigLayer, emptyMcpLayer, testLocationLayer } from "./fixture/mcp"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(CommandV2.node, [
    [MCP.node, emptyMcpLayer],
    [Config.node, emptyConfigLayer],
    [Location.node, testLocationLayer],
  ]),
)

describe("CommandV2", () => {
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
          command.template = "Output: !`printf command-output`"
        })
      })

      expect(yield* command.evaluate({ name: "review" })).toEqual({ text: "Output: command-output" })
    }),
  )

})
