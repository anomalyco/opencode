import { afterEach, describe, expect } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { ReviewFs } from "@/effect/review-fs-layer"
import { ReviewOverlay } from "@opencode-ai/core/review-overlay"
import { ToolRegistry } from "@/tool/registry"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { forceEnableForAcp, reset, setClientWriteTextFileSupported } from "@/acp/review-mode"
import { SessionID, MessageID } from "@/session/schema"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"

// Mirrors HttpApiApp.createRoutes: compile(app) + ReviewFs.defaultLayer on top.
const httpAppLayer = LayerNode.compile(LayerNode.group([FSUtil.node, ToolRegistry.node])).pipe(
  Layer.provide(ReviewFs.defaultLayer),
  Layer.provide(Ripgrep.defaultLayer),
  Layer.provide(CrossSpawnSpawner.defaultLayer),
)

const it = testEffect(httpAppLayer)

const baseCtx = {
  sessionID: SessionID.make("ses_http"),
  messageID: MessageID.make("msg_http"),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const enableReview = () => {
  process.env.OPENCODE_CLIENT = "acp"
  forceEnableForAcp()
  setClientWriteTextFileSupported(true)
  ReviewOverlay.setActiveSession("ses_http")
}

afterEach(async () => {
  delete process.env.OPENCODE_CLIENT
  reset()
  await disposeAllInstances()
})

describe("HTTP app ReviewFs wiring", () => {
  it.instance("ToolRegistry.node with ReviewFs stages edits through the registry", () =>
    Effect.gen(function* () {
      enableReview()
      const test = yield* TestInstance

      const registry = yield* ToolRegistry.Service
      const tools = yield* registry.tools({
        providerID: ProviderV2.ID.opencode,
        modelID: ModelV2.ID.make("test"),
        agent: { name: "build", mode: "primary", permission: [], options: {} },
      })
      const edit = tools.find((tool) => tool.id === "edit")
      if (!edit) throw new Error("edit tool not registered")

      const filepath = path.join(test.directory, "http-edit.txt")
      yield* Effect.promise(() => fs.writeFile(filepath, "before\n", "utf-8"))

      yield* edit.execute({ filePath: filepath, oldString: "before", newString: "after" }, baseCtx)

      const disk = yield* Effect.promise(() => fs.readFile(filepath, "utf-8").catch(() => ""))
      const staged = ReviewOverlay.get(filepath)
      expect(disk).toBe("before\n")
      expect(staged && "content" in staged ? staged.content : undefined).toBe("after\n")
    }),
  )
})
