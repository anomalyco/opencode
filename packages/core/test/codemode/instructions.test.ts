import { describe, expect } from "bun:test"
import { AgentV2 } from "@opencode-ai/core/agent"
import { CodeMode } from "@opencode-ai/core/codemode"
import { CodeModeInstructions } from "@opencode-ai/core/codemode/instructions"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Effect, Layer } from "effect"
import { it } from "../lib/effect"
import { readInitial, readUpdate } from "../lib/instructions"

const agent = AgentV2.Info.make(AgentV2.Info.empty(AgentV2.ID.make("build")))

describe("CodeModeInstructions", () => {
  it.effect("renders catalog changes and removal", () => {
    let catalog: string | undefined = "Initial Code Mode catalog"
    const layer = AppNodeBuilder.build(CodeModeInstructions.node, [
      [
        CodeMode.node,
        Layer.mock(CodeMode.Service, {
          materialize: () => Effect.succeed({ ...(catalog === undefined ? {} : { instructions: catalog }) }),
          register: () => Effect.void,
        }),
      ],
    ])

    return Effect.gen(function* () {
      const instructions = yield* CodeModeInstructions.Service
      const initialized = yield* instructions.load({ id: agent.id, info: agent }).pipe(Effect.flatMap(readInitial))
      expect(initialized.text).toBe("Initial Code Mode catalog")

      catalog = "Updated Code Mode catalog"
      expect(
        yield* instructions
          .load({ id: agent.id, info: agent })
          .pipe(Effect.flatMap((context) => readUpdate(context, initialized))),
      ).toMatchObject({
        text: "The Code Mode tool catalog has changed. This catalog supersedes the previous Code Mode tool catalog.\n\nUpdated Code Mode catalog",
      })

      catalog = undefined
      expect(
        yield* instructions
          .load({ id: agent.id, info: agent })
          .pipe(Effect.flatMap((context) => readUpdate(context, initialized))),
      ).toMatchObject({
        text: "Code Mode tools are no longer available. Do not use any previously listed Code Mode tools.",
      })
    }).pipe(Effect.provide(layer))
  })
})
