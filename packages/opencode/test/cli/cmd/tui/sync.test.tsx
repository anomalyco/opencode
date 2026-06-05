/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { Global } from "@opencode-ai/core/global"
import { tmpdir } from "../../../fixture/fixture"
import { json, mount, wait } from "./sync-fixture"
import type { GlobalEvent, PermissionRequest, QuestionRequest, Session } from "@opencode-ai/sdk/v2"

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

function permission(id: string, sessionID: string): PermissionRequest {
  return {
    id,
    sessionID,
    permission: "edit",
    patterns: [],
    metadata: {},
    always: [],
  }
}

function question(id: string, sessionID: string): QuestionRequest {
  return {
    id,
    sessionID,
    questions: [],
  }
}

function session(id: string): Session {
  return {
    id,
    title: id,
    slug: id,
    projectID: "proj_test",
    directory: "/tmp/opencode/packages/opencode",
    version: "0.0.0-test",
    time: { created: 0, updated: 0 },
  }
}

function sessionDeletedEvent(sessionID: string): GlobalEvent {
  return {
    directory: "/tmp/opencode/packages/opencode",
    project: "proj_test",
    payload: {
      id: `evt_deleted_${sessionID}`,
      type: "session.deleted",
      properties: { sessionID, info: session(sessionID) },
    },
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

  test("bootstrap and refresh reconcile pending request lists authoritatively", async () => {
    const previous = Global.Path.state
    await using tmp = await tmpdir()
    Global.Path.state = tmp.path
    await Bun.write(`${tmp.path}/kv.json`, "{}")

    let permissions = [
      permission("perm-b", "session-a"),
      permission("perm-a", "session-a"),
      permission("perm-c", "session-b"),
    ]
    let questions = [question("question-b", "session-a"), question("question-a", "session-a")]
    const calls = { permission: [] as URL[], question: [] as URL[] }
    const { app, project, sync } = await mount((url) => {
      if (url.pathname === "/permission") {
        calls.permission.push(url)
        return json(permissions)
      }
      if (url.pathname === "/question") {
        calls.question.push(url)
        return json(questions)
      }
      return undefined
    })

    try {
      expect(sync.data.permission["session-a"].map((item) => item.id)).toEqual(["perm-a", "perm-b"])
      expect(sync.data.permission["session-b"].map((item) => item.id)).toEqual(["perm-c"])
      expect(sync.data.question["session-a"].map((item) => item.id)).toEqual(["question-a", "question-b"])
      permissions = [permission("perm-d", "session-b")]
      questions = [question("question-c", "session-c")]
      project.workspace.set("ws_a")
      await sync.pending.refresh()

      expect(calls.permission.at(-1)?.searchParams.get("workspace")).toBe("ws_a")
      expect(calls.question.at(-1)?.searchParams.get("workspace")).toBe("ws_a")
      expect(sync.data.permission["session-a"]).toBeUndefined()
      expect(sync.data.permission["session-b"].map((item) => item.id)).toEqual(["perm-d"])
      expect(sync.data.question["session-a"]).toBeUndefined()
      expect(sync.data.question["session-c"].map((item) => item.id)).toEqual(["question-c"])
    } finally {
      app.renderer.destroy()
      Global.Path.state = previous
    }
  })

  test("pending helpers drop individual requests and session deletion clears session caches", async () => {
    const previous = Global.Path.state
    await using tmp = await tmpdir()
    Global.Path.state = tmp.path
    await Bun.write(`${tmp.path}/kv.json`, "{}")

    const { app, emit, sync } = await mount((url) => {
      if (url.pathname === "/permission") {
        return json([permission("perm-a", "session-a"), permission("perm-b", "session-b")])
      }
      if (url.pathname === "/question") {
        return json([question("question-a", "session-a"), question("question-b", "session-b")])
      }
      return undefined
    })

    try {
      sync.pending.dropPermission("session-a", "perm-a")
      sync.pending.dropQuestion("session-a", "question-a")

      expect(sync.data.permission["session-a"]).toBeUndefined()
      expect(sync.data.question["session-a"]).toBeUndefined()
      expect(sync.data.permission["session-b"].map((item) => item.id)).toEqual(["perm-b"])
      expect(sync.data.question["session-b"].map((item) => item.id)).toEqual(["question-b"])

      emit(sessionDeletedEvent("session-b"))
      await wait(() => !sync.data.permission["session-b"] && !sync.data.question["session-b"])

      expect(sync.data.permission["session-b"]).toBeUndefined()
      expect(sync.data.question["session-b"]).toBeUndefined()
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
})
