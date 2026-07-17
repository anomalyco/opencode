import { describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect } from "effect"
import { InvalidTool } from "../../src/tool/invalid"
import { Truncate } from "@/tool/truncate"
import { Agent } from "../../src/agent/agent"
import { SessionID, MessageID } from "../../src/session/schema"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([Truncate.node, Agent.node])))

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_test"),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

describe("tool.invalid", () => {
  it.instance("strips provider control tokens echoed back in the error", () =>
    Effect.gen(function* () {
      const info = yield* InvalidTool
      const tool = yield* info.init()
      const result = yield* tool.execute(
        {
          tool: "patch",
          error: "JSON parsing failed: Text: <|tool_call_begin|>{ oops <|tool_call_argument_begin|>",
        },
        ctx,
      )

      expect(result.output).not.toContain("<|")
      expect(result.output).not.toContain("|>")
      expect(result.output).toContain("The arguments provided to the tool are invalid:")
    }),
  )
})
