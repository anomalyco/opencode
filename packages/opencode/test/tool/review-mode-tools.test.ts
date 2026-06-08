import { afterEach, describe, expect } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Effect, Layer } from "effect"
import { EditTool } from "../../src/tool/edit"
import { WriteTool } from "../../src/tool/write"
import { ApplyPatchTool } from "../../src/tool/apply_patch"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { LSP } from "@/lsp/lsp"
import { Format } from "../../src/format"
import { Agent } from "../../src/agent/agent"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { Truncate } from "@/tool/truncate"
import { SessionID, MessageID } from "../../src/session/schema"
import { testEffect } from "../lib/effect"
import { ReviewFs } from "@/effect/review-fs-layer"
import { ReviewOverlay } from "@opencode-ai/core/review-overlay"
import { forceEnableForAcp, reset, setClientWriteTextFileSupported } from "@/acp/review-mode"
import { completedToolContent } from "@/acp/tool"
import { ToolRegistry } from "@/tool/registry"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"

const baseCtx = {
  sessionID: SessionID.make("ses_review"),
  messageID: MessageID.make("msg_review"),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const layer = Layer.mergeAll(
  LSP.defaultLayer,
  ReviewFs.defaultLayer,
  Format.defaultLayer,
  EventV2Bridge.defaultLayer,
  Truncate.defaultLayer,
  Agent.defaultLayer,
)

const it = testEffect(layer)

afterEach(async () => {
  delete process.env.OPENCODE_ACP_REVIEW
  delete process.env.OPENCODE_CLIENT
  reset()
  await disposeAllInstances()
})

const enableReview = () => {
  process.env.OPENCODE_CLIENT = "acp"
  forceEnableForAcp()
  setClientWriteTextFileSupported(true)
  ReviewOverlay.setActiveSession("ses_review")
}

const readDisk = (filepath: string) => Effect.promise(() => fs.readFile(filepath, "utf-8").catch(() => ""))

describe("review mode tools", () => {
  it.instance("edit stages without disk write", () =>
    Effect.gen(function* () {
      enableReview()
      const test = yield* TestInstance
      const edit = yield* EditTool
      const tool = yield* edit.init()

      const filepath = path.join(test.directory, "edit.txt")
      yield* Effect.promise(() => fs.writeFile(filepath, "before\n", "utf-8"))

      yield* tool.execute(
        {
          filePath: filepath,
          oldString: "before",
          newString: "after",
        },
        baseCtx,
      )

      expect(yield* readDisk(filepath)).toBe("before\n")
      const staged = ReviewOverlay.get(filepath)
      expect(staged && "content" in staged ? staged.content : undefined).toBe("after\n")
    }),
  )

  it.instance("write stages new files without disk write", () =>
    Effect.gen(function* () {
      enableReview()
      const test = yield* TestInstance
      const write = yield* WriteTool
      const tool = yield* write.init()

      const filepath = path.join(test.directory, "new.txt")
      yield* tool.execute({ filePath: filepath, content: "created" }, baseCtx)

      expect(yield* readDisk(filepath)).toBe("")
      expect(ReviewOverlay.get(filepath)).toEqual({ content: "created" })
    }),
  )

  it.instance("apply_patch stages add/update and deletes on disk", () =>
    Effect.gen(function* () {
      enableReview()
      const test = yield* TestInstance
      const patch = yield* ApplyPatchTool
      const tool = yield* patch.init()

      const updatePath = path.join(test.directory, "update.txt")
      const deletePath = path.join(test.directory, "delete.txt")
      yield* Effect.promise(() => fs.writeFile(updatePath, "old\n", "utf-8"))
      yield* Effect.promise(() => fs.writeFile(deletePath, "gone\n", "utf-8"))

      const patchText = [
        "*** Begin Patch",
        "*** Add File: added.txt",
        "+added",
        "*** Update File: update.txt",
        "@@",
        "-old",
        "+new",
        "*** Delete File: delete.txt",
        "*** End Patch",
      ].join("\n")

      const result = yield* tool.execute({ patchText }, baseCtx)

      expect(yield* readDisk(path.join(test.directory, "added.txt"))).toBe("")
      expect(yield* readDisk(updatePath)).toBe("old\n")
      expect(yield* readDisk(deletePath)).toBe("")

      expect(ReviewOverlay.get(path.join(test.directory, "added.txt"))).toEqual({ content: "added\n" })
      expect(ReviewOverlay.get(updatePath)).toEqual({ content: "new\n" })

      // delete/move bypass staging (ACP has no deleteFile), so the output must
      // warn that those changes already hit disk and won't be undone on reject.
      expect(result.output).toContain("applied directly to disk")

      const content = completedToolContent("apply_patch", {
        status: "completed",
        input: { patchText },
        output: result.output,
        metadata: result.metadata,
      })
      expect(content.some((item) => item.type === "diff" && item.path === deletePath && item.newText === "")).toBe(
        true,
      )
    }),
  )
})

// Regression: tools resolved through the production ToolRegistry wiring must
// stage instead of writing to disk. The direct-tool tests above can pass even
// when ToolRegistry injects the plain FSUtil layer, so this exercises the real
// path that ACP prompts go through.
const registryIt = testEffect(Layer.mergeAll(ToolRegistry.defaultLayer, Agent.defaultLayer))

describe("review mode via ToolRegistry", () => {
  registryIt.instance("edit staged through registry does not touch disk", () =>
    Effect.gen(function* () {
      enableReview()
      const test = yield* TestInstance
      const agent = yield* Agent.Service
      const build = yield* agent.get("build")
      if (!build) throw new Error("build agent not found")

      const registry = yield* ToolRegistry.Service
      const tools = yield* registry.tools({
        providerID: ProviderV2.ID.opencode,
        modelID: ModelV2.ID.make("test"),
        agent: build,
      })
      const edit = tools.find((tool) => tool.id === "edit")
      if (!edit) throw new Error("edit tool not registered")

      const filepath = path.join(test.directory, "registry-edit.txt")
      yield* Effect.promise(() => fs.writeFile(filepath, "before\n", "utf-8"))

      yield* edit.execute({ filePath: filepath, oldString: "before", newString: "after" }, baseCtx)

      expect(yield* readDisk(filepath)).toBe("before\n")
      const staged = ReviewOverlay.get(filepath)
      expect(staged && "content" in staged ? staged.content : undefined).toBe("after\n")
    }),
  )
})
