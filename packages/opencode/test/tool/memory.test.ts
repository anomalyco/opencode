import { describe, expect, afterEach } from "bun:test"
import { Effect } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { ToolRegistry } from "@/tool/registry"
import { disposeAllInstances } from "../fixture/fixture"
import { SessionID, MessageID } from "../../src/session/schema"
import { testEffect } from "../lib/effect"
import type { Tool } from "../../src/tool/tool"

afterEach(async () => {
  await disposeAllInstances()
})

const it = testEffect(LayerNode.compile(LayerNode.group([ToolRegistry.node, CrossSpawnSpawner.node, Ripgrep.node])))

describe("tool.memory", () => {
  it.instance("initializes and executes teach, recall, list, and delete", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const allTools = yield* registry.all()
      const memoryTool = allTools.find((t) => t.id === "memory")
      expect(memoryTool).toBeDefined()

      const mockCtx: Tool.Context<any> = {
        sessionID: SessionID.make("ses_mem_test"),
        messageID: MessageID.make("msg_mem_test"),
        agent: "build",
        abort: AbortSignal.any([]),
        messages: [],
        metadata: () => Effect.void,
        ask: () => Effect.void,
      }

      // 1. Teach
      const teachResult = yield* memoryTool!.execute(
        {
          action: "teach",
          title: "Architecture Rule",
          content: "Always keep memory persistent in SQLite .db files with WAL mode.",
          category: "architecture",
          tags: ["sqlite", "persistence"],
        },
        mockCtx,
      )
      expect(teachResult.title).toContain("Saved memory")
      expect(teachResult.output).toContain("Architecture Rule")
      const memoryId = teachResult.metadata.id

      // 2. Recall
      const recallResult = yield* memoryTool!.execute(
        {
          action: "recall",
          query: "SQLite persistence",
        },
        mockCtx,
      )
      expect(recallResult.title).toContain("Recalled")
      expect(recallResult.output).toContain("Architecture Rule")

      // 3. List
      const listResult = yield* memoryTool!.execute(
        {
          action: "list",
        },
        mockCtx,
      )
      expect(listResult.output).toContain("Architecture Rule")

      // 4. Delete
      if (memoryId) {
        const deleteResult = yield* memoryTool!.execute(
          {
            action: "delete",
            id: memoryId,
          },
          mockCtx,
        )
        expect(deleteResult.title).toContain("Deleted memory")
      }
    }),
    30000,
  )
})
