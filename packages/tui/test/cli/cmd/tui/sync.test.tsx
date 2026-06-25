/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { tmpdir } from "../../../fixture/fixture"
import { mount, wait } from "./sync-fixture"
import type { GlobalEvent } from "@opencode-ai/sdk/v2"

function branchEvent(branch: string, workspace?: string): GlobalEvent {
  return {
    directory: "/tmp/other",
    project: "proj_test",
    workspace,
    payload: {
      id: `evt_vcs_${branch}`,
      type: "vcs.branch.updated",
      properties: { branch },
    },
  }
}

function elicitationAsked(id: string): GlobalEvent {
  return {
    directory: "/tmp/opencode/packages/tui",
    project: "proj_test",
    payload: {
      id: `evt_elicitation_${id}`,
      type: "mcp.elicitation.asked",
      properties: {
        id,
        server: "unity-gateway",
        message: "Approve resolved Unity command?",
        schema: {
          type: "object",
          properties: {
            allowed: { type: "boolean", title: "Allow command" },
          },
          required: ["allowed"],
        },
      },
    },
  }
}

function elicitationReplied(requestID: string): GlobalEvent {
  return {
    directory: "/tmp/opencode/packages/tui",
    project: "proj_test",
    payload: {
      id: `evt_elicitation_replied_${requestID}`,
      type: "mcp.elicitation.replied",
      properties: {
        requestID,
        result: { action: "cancel" },
      },
    },
  }
}

describe("tui sync", () => {
  test("refresh scopes sessions by default and lists project sessions when disabled", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const { app, kv, sync, session } = await mount(undefined, tmp.path)

    try {
      expect(kv.get("session_directory_filter_enabled", true)).toBe(true)
      expect(session.at(-1)?.searchParams.get("roots")).toBeNull()
      expect(session.at(-1)?.searchParams.get("scope")).toBeNull()
      expect(session.at(-1)?.searchParams.get("path")).toBe("packages/tui")

      kv.set("session_directory_filter_enabled", false)
      await sync.session.refresh()

      expect(session.at(-1)?.searchParams.get("scope")).toBe("project")
      expect(session.at(-1)?.searchParams.get("path")).toBeNull()
      expect(session.at(-1)?.searchParams.get("roots")).toBeNull()
    } finally {
      app.renderer.destroy()
    }
  })

  test("vcs branch updates only apply for the active workspace", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const { app, emit, project, sync } = await mount(undefined, tmp.path)

    try {
      expect(sync.data.vcs?.branch).toBe("main")

      project.workspace.set("ws_a")
      emit(branchEvent("other", "ws_b"))
      await Bun.sleep(30)

      expect(sync.data.vcs?.branch).toBe("main")

      emit(branchEvent("feature", "ws_a"))
      await wait(() => sync.data.vcs?.branch === "feature")

      expect(sync.data.vcs?.branch).toBe("feature")
    } finally {
      app.renderer.destroy()
    }
  })

  test("tracks pending MCP elicitations", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const { app, emit, sync } = await mount(undefined, tmp.path)

    try {
      emit(elicitationAsked("mcpel_test"))
      await wait(() => sync.data.mcp_elicitation.length === 1)

      expect(sync.data.mcp_elicitation).toEqual([
        expect.objectContaining({
          id: "mcpel_test",
          server: "unity-gateway",
          message: "Approve resolved Unity command?",
        }),
      ])

      emit(elicitationReplied("mcpel_test"))
      await wait(() => sync.data.mcp_elicitation.length === 0)
      expect(sync.data.mcp_elicitation).toEqual([])
    } finally {
      app.renderer.destroy()
    }
  })
})
