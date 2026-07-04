import { afterEach, describe, expect } from "bun:test"
import { AgentV2 } from "@opencode-ai/core/agent"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { MCP } from "@opencode-ai/core/mcp/index"
import { McpGuidance } from "@opencode-ai/core/mcp/guidance"
import { SystemContext } from "@opencode-ai/core/system-context/index"
import { Effect, Layer } from "effect"
import { testEffect } from "./lib/effect"

const previous = process.env.OPENCODE_CODE_MODE
const id = AgentV2.ID.make("build")
const selection = { id, info: AgentV2.Info.empty(id) }
const it = testEffect(
  AppNodeBuilder.build(McpGuidance.node, [
    [
      MCP.node,
      Layer.mock(MCP.Service, {
        instructions: () =>
          Effect.succeed([
            new MCP.ServerInstructions({
              server: MCP.ServerName.make("context7"),
              instructions: "Call resolve-library-id first.",
            }),
          ]),
        tools: () =>
          Effect.succeed([new MCP.Tool({ server: MCP.ServerName.make("context7"), name: "resolve-library-id" })]),
      }),
    ],
  ]),
)

afterEach(() => {
  if (previous === undefined) delete process.env.OPENCODE_CODE_MODE
  else process.env.OPENCODE_CODE_MODE = previous
})

describe("McpGuidance", () => {
  it.effect("omits direct tool instructions in CodeMode", () =>
    Effect.gen(function* () {
      delete process.env.OPENCODE_CODE_MODE
      const guidance = yield* McpGuidance.Service
      expect((yield* SystemContext.initialize(yield* guidance.load(selection))).text).toBe("")
    }),
  )

  it.effect("includes server instructions with direct MCP tools", () =>
    Effect.gen(function* () {
      process.env.OPENCODE_CODE_MODE = "false"
      const guidance = yield* McpGuidance.Service
      expect((yield* SystemContext.initialize(yield* guidance.load(selection))).text).toContain(
        "Call resolve-library-id first.",
      )
    }),
  )
})
