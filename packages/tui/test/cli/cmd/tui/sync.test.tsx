/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { tmpdir } from "../../../fixture/fixture"
import { directory, mount, wait } from "./sync-fixture"
import type { GlobalEvent, Session } from "@opencode-ai/sdk/v2"

function branchEvent(branch: string, opts?: { workspace?: string; directory?: string }): GlobalEvent {
  return {
    directory: opts?.directory ?? "/tmp/other",
    project: "proj_test",
    workspace: opts?.workspace,
    payload: {
      id: `evt_vcs_${branch}`,
      type: "vcs.branch.updated",
      properties: { branch },
    },
  }
}

function sessionEvent(id: string, sessionDirectory: string): GlobalEvent {
  const info = {
    id,
    slug: "test-session",
    directory: sessionDirectory,
    path: "",
    title: `session ${id}`,
    projectID: "proj_test",
    time: { created: 1, updated: 1 },
  } satisfies Partial<Session> as Session
  return {
    directory: sessionDirectory,
    project: "proj_test",
    workspace: undefined,
    payload: {
      id: `evt_ses_${id}`,
      type: "session.updated",
      properties: { sessionID: id, info },
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

  test("vcs branch updates only apply for the active workspace and directory", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const { app, emit, project, sync } = await mount(undefined, tmp.path)

    try {
      expect(sync.data.vcs?.branch).toBe("main")

      project.workspace.set("ws_a")

      // foreign directory + foreign workspace -> dropped
      emit(branchEvent("other", { workspace: "ws_b" }))
      await Bun.sleep(30)
      expect(sync.data.vcs?.branch).toBe("main")

      // foreign directory + active workspace -> dropped (the branch belongs
      // to another workspace's repository)
      emit(branchEvent("other-dir", { workspace: "ws_a" }))
      await Bun.sleep(30)
      expect(sync.data.vcs?.branch).toBe("main")

      // own directory + active workspace -> applied
      emit(branchEvent("feature", { workspace: "ws_a", directory }))
      await wait(() => sync.data.vcs?.branch === "feature")

      expect(sync.data.vcs?.branch).toBe("feature")
    } finally {
      app.renderer.destroy()
    }
  })

  test("session updates from other directories do not enter the local session list", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const { app, emit, sync } = await mount(undefined, tmp.path)

    try {
      emit(sessionEvent("ses_foreign", "/tmp/other"))
      await Bun.sleep(30)
      expect(sync.session.get("ses_foreign")).toBeUndefined()

      emit(sessionEvent("ses_own", directory))
      await wait(() => sync.session.get("ses_own") !== undefined)
      expect(sync.session.get("ses_own")?.directory).toBe(directory)
    } finally {
      app.renderer.destroy()
    }
  })
})
