import { afterEach, describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { Effect, Exit } from "effect"
import { Agent } from "../../src/agent/agent"
import { MemoryTool } from "@/tool/memory"
import { Truncate } from "@/tool/truncate"
import { disposeAllInstances } from "../fixture/fixture"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

afterEach(async () => {
  await disposeAllInstances()
})

const layer = () => LayerNode.compile(LayerNode.group([FSUtil.node, Truncate.node, Agent.node, Global.node]))

const it = testEffect(layer())

describe("MemoryTool", () => {
  it.instance("writes, lists, reads and deletes memories", () =>
    Effect.gen(function* () {
      const tool = yield* MemoryTool
      const def = yield* tool.init()
      yield* TestInstance

      const ctx = {
        sessionID: "ses_test",
        messageID: "msg_test",
        agent: "build",
        abort: new AbortController().signal,
        ask: () => Effect.void,
        metadata: () => Effect.void,
      } as never

      const write = yield* def.execute({ action: "write", name: "environment/user-prefs", content: "# Prefers bun" }, ctx)
      expect(write.output).toContain("Stored memory")

      const list = yield* def.execute({ action: "list" }, ctx)
      expect(list.output).toContain("user-prefs")
      expect(list.output).toContain("Prefers bun")

      const read = yield* def.execute({ action: "read", name: "environment/user-prefs" }, ctx)
      expect(read.output).toBe("# Prefers bun")

      const del = yield* def.execute({ action: "delete", name: "environment/user-prefs" }, ctx)
      expect(del.output).toContain("Deleted")

      const emptyList = yield* def.execute({ action: "list" }, ctx)
      expect(emptyList.output).toContain("No memories")
    }),
  )

  it.instance("rejects path traversal names", () =>
    Effect.gen(function* () {
      const tool = yield* MemoryTool
      const def = yield* tool.init()
      const ctx = {
        sessionID: "ses_test",
        messageID: "msg_test",
        agent: "build",
        abort: new AbortController().signal,
        ask: () => Effect.void,
        metadata: () => Effect.void,
      } as never

      const exit = yield* def.execute({ action: "write", name: "../../escape", content: "x" }, ctx).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )
})
