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

function messageEvent(sessionID: string, messageID: string): GlobalEvent {
  return {
    directory: "/tmp/other",
    project: "proj_test",
    payload: {
      id: `evt_msg_${messageID}`,
      type: "message.updated",
      // Cast to `any` because the schema requires a full AssistantMessage
      // shape (parentID, modelID, providerID, mode, agent, path, ...).
      // The TUI store only reads `info.id`, `info.sessionID`, and `info.role`
      // for the message.updated handler, so a minimal object is enough
      // for the store update to fire.
      properties: { sessionID, info: { id: messageID, role: "assistant", sessionID, time: { created: Date.now() } } as any },
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
      expect(session.at(-1)?.searchParams.get("scope")).toBeNull()
      expect(session.at(-1)?.searchParams.get("path")).toBe("packages/tui")

      kv.set("session_directory_filter_enabled", false)
      await sync.session.refresh()

      expect(session.at(-1)?.searchParams.get("scope")).toBe("project")
      expect(session.at(-1)?.searchParams.get("path")).toBeNull()
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

  test("sync.session.sync() is a no-op on an already-hydrated session", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const { app, sync, sessionDetail } = await mount(undefined, tmp.path)

    try {
      // No session-detail calls have been made yet.
      const before = sessionDetail.filter((u) => u.pathname.includes("/session/syn_first"))
      expect(before).toHaveLength(0)

      await sync.session.sync("syn_first")
      const afterFirst = sessionDetail.filter((u) => u.pathname.includes("/session/syn_first"))
      // session.get + messages + todo + diff = 4 fetches per hydration.
      expect(afterFirst.length).toBe(4)

      const lengthBefore = sessionDetail.length
      await sync.session.sync("syn_first")
      // No additional fetch — short-circuited by fullSyncedSessions.
      expect(sessionDetail.length - lengthBefore).toBe(0)
    } finally {
      app.renderer.destroy()
    }
  })

  test("sync.session.sync(id, { force: true }) bypasses the fullSyncedSessions cache", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const { app, sync, sessionDetail } = await mount(undefined, tmp.path)

    try {
      await sync.session.sync("syn_force")
      expect(sessionDetail.filter((u) => u.pathname.includes("/session/syn_force")).length).toBe(4)

      const lengthBefore = sessionDetail.length
      await sync.session.sync("syn_force", { force: true })
      // Force option re-fetches even though the session is already in
      // fullSyncedSessions, picking up external-writer changes the SSE
      // stream may have missed.
      const after = sessionDetail.filter(
        (u) => u.pathname.includes("/session/syn_force") && sessionDetail.indexOf(u) >= lengthBefore,
      )
      expect(after.length).toBe(4)
    } finally {
      app.renderer.destroy()
    }
  })

  test("force option still de-dupes when a sync is already in flight", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const { app, sync, sessionDetail } = await mount(undefined, tmp.path)

    try {
      // Two parallel force calls should share a single underlying fetch
      // via the syncingSessions guard, not double-fetch.
      const lengthBefore = sessionDetail.length
      await Promise.all([
        sync.session.sync("syn_dedup", { force: true }),
        sync.session.sync("syn_dedup", { force: true }),
      ])
      const newCalls = sessionDetail
        .slice(lengthBefore)
        .filter((u) => u.pathname.includes("/session/syn_dedup"))
      // Each `sync()` makes 4 parallel fetches (session.get, messages, todo, diff).
      // The guard should ensure we make those 4 once, not 8.
      expect(newCalls.length).toBe(4)
    } finally {
      app.renderer.destroy()
    }
  })

  test("force option picks up messages written externally to the session", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const { app, emit, sync, sessionDetail } = await mount(undefined, tmp.path)

    try {
      await sync.session.sync("syn_external")
      expect(sync.data.message["syn_external"] ?? []).toHaveLength(0)

      // Initial sync issued 4 session-detail calls (get/messages/todo/diff).
      const lengthBefore = sessionDetail.length
      expect(lengthBefore).toBeGreaterThan(0)

      // Simulate an external writer producing a message and emit the SSE
      // event. The store update happens asynchronously — wait for the
      // message to land before continuing.
      emit(messageEvent("syn_external", "msg_external"))
      await wait(() => (sync.data.message["syn_external"] ?? []).some((m) => m.id === "msg_external"))

      // A force re-sync MUST issue a new round of session-detail fetches
      // (the regression for #31073 was that subsequent syncs short-circuited
      // forever, so external-writer changes were never re-fetched). We do
      // not assert on post-sync store contents here because the test fixture
      // returns empty messages from the server — that would wipe the SSE-
      // delivered message. The fetch-count assertion is the relevant
      // invariant.
      await sync.session.sync("syn_external", { force: true })
      const newCalls = sessionDetail.slice(lengthBefore).filter((u) => u.pathname.includes("/session/syn_external"))
      // session.get + messages + todo + diff = 4 fetches per force re-sync.
      expect(newCalls.length).toBe(4)
    } finally {
      app.renderer.destroy()
    }
  })
})
