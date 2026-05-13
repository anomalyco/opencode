/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { Global } from "@opencode-ai/core/global"
import { tmpdir } from "../../../fixture/fixture"
import { directory, json, mount, wait } from "./sync-fixture"
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

function sessionMessage(id: string, role: "user" | "assistant", time: number) {
  return {
    info: {
      id,
      sessionID: "ses_test",
      role,
      time: {
        created: time,
        completed: time,
      },
    },
    parts: [],
  }
}

describe("tui sync", () => {
  test("refresh scopes sessions by default and lists project sessions when disabled", async () => {
    const previous = Global.Path.state
    await using tmp = await tmpdir()
    Global.Path.state = tmp.path
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const { app, kv, sync, session } = await mount()

    try {
      expect(kv.get("session_directory_filter_enabled", true)).toBe(true)
      expect(session.at(-1)?.searchParams.get("scope")).toBeNull()
      expect(session.at(-1)?.searchParams.get("path")).toBe("packages/opencode")

      kv.set("session_directory_filter_enabled", false)
      await sync.session.refresh()

      expect(session.at(-1)?.searchParams.get("scope")).toBe("project")
      expect(session.at(-1)?.searchParams.get("path")).toBeNull()
    } finally {
      app.renderer.destroy()
      Global.Path.state = previous
    }
  })

  test("vcs branch updates only apply for the active workspace", async () => {
    const previous = Global.Path.state
    await using tmp = await tmpdir()
    Global.Path.state = tmp.path
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const { app, emit, project, sync } = await mount()

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
      Global.Path.state = previous
    }
  })

  test("reconnect refresh loads messages missed by live events", async () => {
    const previous = Global.Path.state
    await using tmp = await tmpdir()
    Global.Path.state = tmp.path
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const messages = [sessionMessage("msg_1", "user", 1)]
    const testSession = {
      id: "ses_test",
      projectID: "proj_test",
      title: "Test session",
      time: {
        created: 1,
        updated: 1,
      },
    }
    const { app, emit, sync } = await mount((url) => {
      switch (url.pathname) {
        case "/session/ses_test":
          return json(testSession)
        case "/session/ses_test/diff":
        case "/session/ses_test/todo":
          return json([])
        case "/session/ses_test/message":
          return json(messages)
      }
    })

    try {
      await sync.session.sync("ses_test")
      expect(sync.data.message.ses_test.map((message) => message.id)).toEqual(["msg_1"])

      messages.push(sessionMessage("msg_2", "assistant", 2))
      emit({
        directory,
        project: "proj_test",
        payload: {
          id: "evt_test_connected",
          type: "server.connected",
          properties: {},
        },
      })

      await wait(() => sync.data.message.ses_test?.some((message) => message.id === "msg_2") ?? false)
      expect(sync.data.message.ses_test.map((message) => message.id)).toEqual(["msg_1", "msg_2"])
    } finally {
      app.renderer.destroy()
      Global.Path.state = previous
    }
  })
})
