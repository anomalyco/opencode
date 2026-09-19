/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { tmpdir } from "../../../fixture/fixture"
import { mount, wait } from "./sync-fixture"
import { rememberDeleted } from "../../../../src/context/sync"
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

function global(payload: GlobalEvent["payload"]): GlobalEvent {
  return { directory: "/tmp/other", project: "proj_test", payload }
}

describe("sync tombstone bounds", () => {
  test("rememberDeleted evicts the oldest tombstone beyond the cap", () => {
    const deleted = new Set<string>()
    for (let index = 0; index < 5; index++) rememberDeleted(deleted, `ses_${index}`, 3)

    expect([...deleted]).toEqual(["ses_2", "ses_3", "ses_4"])
  })

  test("rememberDeleted moves an existing id to the newest position", () => {
    const deleted = new Set<string>()
    rememberDeleted(deleted, "ses_a", 2)
    rememberDeleted(deleted, "ses_b", 2)
    rememberDeleted(deleted, "ses_a", 2)

    expect([...deleted]).toEqual(["ses_b", "ses_a"])
  })
})

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

  test("session.deleted prunes every session-keyed slice", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const { app, emit, sync } = await mount(undefined, tmp.path)

    const pruneSessionID = "ses_prune"
    const pruneMessageID = "msg_prune"
    const prunePartID = "prt_prune"
    const info = {
      id: pruneSessionID,
      slug: pruneSessionID,
      projectID: "project",
      directory: "/tmp/opencode/packages/tui",
      title: "prune",
      version: "1.15.13",
      time: { created: 0, updated: 0 },
    }
    const message = {
      id: pruneMessageID,
      sessionID: pruneSessionID,
      role: "user" as const,
      agent: "build",
      model: { providerID: "test", modelID: "model" },
      time: { created: 0 },
    }

    try {
      emit(
        global({ id: "evt_prune_session", type: "session.updated", properties: { sessionID: pruneSessionID, info } }),
      )
      emit(
        global({
          id: "evt_prune_message",
          type: "message.updated",
          properties: { sessionID: pruneSessionID, info: message },
        }),
      )
      emit(
        global({
          id: "evt_prune_part",
          type: "message.part.updated",
          properties: {
            sessionID: pruneSessionID,
            time: 1,
            part: { id: prunePartID, sessionID: pruneSessionID, messageID: pruneMessageID, type: "text", text: "hi" },
          },
        }),
      )
      emit(global({ id: "evt_prune_todo", type: "todo.updated", properties: { sessionID: pruneSessionID, todos: [] } }))
      emit(global({ id: "evt_prune_diff", type: "session.diff", properties: { sessionID: pruneSessionID, diff: [] } }))

      await wait(
        () =>
          sync.data.message[pruneSessionID] !== undefined &&
          sync.data.part[pruneMessageID] !== undefined &&
          sync.data.todo[pruneSessionID] !== undefined &&
          sync.data.session_diff[pruneSessionID] !== undefined,
      )

      emit(
        global({ id: "evt_prune_deleted", type: "session.deleted", properties: { sessionID: pruneSessionID, info } }),
      )

      await wait(() => sync.data.message[pruneSessionID] === undefined)
      expect(sync.data.message[pruneSessionID]).toBeUndefined()
      expect(sync.data.part[pruneMessageID]).toBeUndefined()
      expect(sync.data.todo[pruneSessionID]).toBeUndefined()
      expect(sync.data.session_diff[pruneSessionID]).toBeUndefined()
      expect(sync.data.session.some((item) => item.id === pruneSessionID)).toBe(false)
    } finally {
      app.renderer.destroy()
    }
  })

  test("live events cannot repopulate a deleted session's mirror slices", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const { app, emit, sync } = await mount(undefined, tmp.path)

    const sessionID = "ses_deleted_live"
    const messageID = "msg_deleted_live"
    const info = {
      id: sessionID,
      slug: sessionID,
      projectID: "project",
      directory: "/tmp/opencode/packages/tui",
      title: "deleted",
      version: "1.15.13",
      time: { created: 0, updated: 0 },
    }
    const message = {
      id: messageID,
      sessionID,
      role: "user" as const,
      agent: "build",
      model: { providerID: "test", modelID: "model" },
      time: { created: 0 },
    }

    try {
      emit(global({ id: "evt_del_session", type: "session.deleted", properties: { sessionID, info } }))
      emit(global({ id: "evt_del_todo", type: "todo.updated", properties: { sessionID, todos: [] } }))
      emit(global({ id: "evt_del_diff", type: "session.diff", properties: { sessionID, diff: [] } }))
      emit(
        global({ id: "evt_del_message", type: "message.updated", properties: { sessionID, info: message } }),
      )
      emit(
        global({
          id: "evt_del_part",
          type: "message.part.updated",
          properties: {
            sessionID,
            time: 1,
            part: { id: "prt_del", sessionID, messageID, type: "text", text: "late" },
          },
        }),
      )
      await Bun.sleep(30)

      expect(sync.data.todo[sessionID]).toBeUndefined()
      expect(sync.data.session_diff[sessionID]).toBeUndefined()
      expect(sync.data.message[sessionID]).toBeUndefined()
      expect(sync.data.part[messageID]).toBeUndefined()
    } finally {
      app.renderer.destroy()
    }
  })

  test("late permission and question events cannot repopulate a deleted session", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const { app, emit, sync } = await mount(undefined, tmp.path)

    const sessionID = "ses_deleted_attention"
    const info = {
      id: sessionID,
      slug: sessionID,
      projectID: "project",
      directory: "/tmp/opencode/packages/tui",
      title: "deleted",
      version: "1.15.13",
      time: { created: 0, updated: 0 },
    }
    const permission = {
      id: "per_deleted",
      sessionID,
      permission: "edit",
      patterns: [],
      metadata: {},
      always: [],
    }
    const question = { id: "que_deleted", sessionID, questions: [] }

    try {
      emit(global({ id: "evt_attn_deleted", type: "session.deleted", properties: { sessionID, info } }))
      emit(global({ id: "evt_attn_permission", type: "permission.asked", properties: permission }))
      emit(global({ id: "evt_attn_question", type: "question.asked", properties: question }))
      await Bun.sleep(30)

      expect(sync.data.permission[sessionID]).toBeUndefined()
      expect(sync.data.question[sessionID]).toBeUndefined()
    } finally {
      app.renderer.destroy()
    }
  })
})
