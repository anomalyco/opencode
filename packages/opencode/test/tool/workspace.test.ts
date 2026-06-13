import { PermissionV1 } from "@cedric/core/v1/permission"
import { afterEach, describe, expect } from "bun:test"
import { Effect } from "effect"
import { GlobalBus, type GlobalEvent } from "@/bus/global"
import { MessageID, SessionID } from "@/session/schema"
import { ToolRegistry } from "@/tool/registry"
import type { Tool } from "@/tool/tool"
import { WorkspaceTool } from "@/tool/workspace"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(ToolRegistry.defaultLayer)

const baseCtx: Omit<Tool.Context, "ask"> = {
  sessionID: SessionID.make("ses_workspace_tool"),
  messageID: MessageID.make("msg_workspace_tool"),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
}

afterEach(async () => {
  await disposeAllInstances()
})

describe("tool.workspace", () => {
  it.instance("publishes workspace action requests", () =>
    Effect.gen(function* () {
      const seen: GlobalEvent[] = []
      const listener = (event: GlobalEvent) => {
        if (event.payload.type === "workspace.action.requested") seen.push(event)
      }
      GlobalBus.on("event", listener)
      yield* Effect.addFinalizer(() => Effect.sync(() => GlobalBus.off("event", listener)))

      const registry = yield* ToolRegistry.Service
      const tool = (yield* registry.tools({
        providerID: "opencode" as any,
        modelID: "gpt-5" as any,
        agent: { name: "build", mode: "primary" as const, permission: [], options: {} },
      })).find((tool) => tool.id === WorkspaceTool.id)
      if (!tool) throw new Error("Workspace tool not found")

      const requests: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
      const result = yield* tool.execute(
        { action: "open_file", path: "src/app.tsx", title: "App" },
        {
          ...baseCtx,
          ask: (request) =>
            Effect.sync(() => {
              requests.push(request)
            }),
        },
      )

      expect(requests[0]).toMatchObject({
        permission: "workspace",
        patterns: ["open_file:src/app.tsx"],
      })
      expect(result.output).toContain("Requested open_file for src/app.tsx.")
      expect(seen).toHaveLength(1)
      expect(seen[0]?.payload.properties).toEqual({
        sessionID: "ses_workspace_tool",
        action: {
          type: "openFile",
          path: "src/app.tsx",
          title: "App",
        },
      })
    }),
  )
})
