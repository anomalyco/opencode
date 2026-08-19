import { describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect } from "effect"
import { Agent } from "../../src/agent/agent"
import { SessionID, MessageID } from "../../src/session/schema"
import { Truncate } from "../../src/tool/truncate"
import { VisualizationTool } from "../../src/tool/visualization"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([Truncate.node, Agent.node])))

const ctx = {
  sessionID: SessionID.make("ses_visualization"),
  messageID: MessageID.make("msg_visualization"),
  callID: "call_visualization",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

describe("tool.visualization", () => {
  it.instance("returns inline preview metadata while hiding HTML from model output", () =>
    Effect.gen(function* () {
      const info = yield* VisualizationTool
      const tool = yield* info.init()
      const html = '<section data-kind="clock">10:21</section>'

      expect(tool.description).toContain("transparent conversation background")
      expect(tool.description).toContain("100vh")
      expect(tool.description).toContain("negative page margins")

      const result = yield* tool.execute({ title: "  Clock  ", html }, ctx)

      expect(result).toEqual({
        title: "Clock",
        output: "Visualization created",
        metadata: { version: 1, title: "Clock", html, truncated: false },
      })
    }),
  )
})
