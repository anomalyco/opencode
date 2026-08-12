/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { tmpdir } from "../../../fixture/fixture"
import { json, mount, wait } from "./sync-fixture"
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

function globalEvent(payload: GlobalEvent["payload"]): GlobalEvent {
  return { directory: "/tmp/other", project: "proj_test", payload }
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

  test("bootstraps pending permission and question requests", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const { app, sync } = await mount((url) => {
      if (url.pathname === "/permission") {
        return json([
          {
            id: "perm_2",
            sessionID: "ses_pending",
            permission: "edit",
            patterns: ["C:/Users/matt/permission-test.txt"],
            metadata: { filepath: "C:/Users/matt/permission-test.txt" },
            always: ["C:/Users/matt/permission-test.txt"],
          },
          {
            id: "perm_1",
            sessionID: "ses_pending",
            permission: "bash",
            patterns: ["bun test"],
            metadata: { command: "bun test" },
            always: ["bun test"],
          },
        ])
      }
      if (url.pathname === "/question") {
        return json([
          {
            id: "ques_1",
            sessionID: "ses_pending",
            questions: [
              {
                type: "select",
                header: "Continue?",
                question: "Continue?",
                options: [
                  {
                    label: "Yes",
                    description: "Continue",
                  },
                ],
              },
            ],
          },
        ])
      }
      return undefined
    }, tmp.path)

    try {
      await wait(() => sync.data.permission.ses_pending !== undefined)
      expect(sync.data.permission.ses_pending.map((item) => item.id)).toEqual(["perm_1", "perm_2"])
      expect(sync.data.question.ses_pending.map((item) => item.id)).toEqual(["ques_1"])
    } finally {
      app.renderer.destroy()
    }
  })

  test("keeps live permission requests when bootstrap list resolves stale", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    let resolvePermission!: (response: Response) => void
    const permissionList = new Promise<Response>((resolve) => {
      resolvePermission = resolve
    })
    const { app, emit, sync } = await mount(
      (url) => {
        if (url.pathname === "/permission") return permissionList
        if (url.pathname === "/question") return json([])
        return undefined
      },
      tmp.path,
      { waitForComplete: false },
    )

    try {
      await Bun.sleep(0)
      emit(
        globalEvent({
          id: "evt_perm_live",
          type: "permission.asked",
          properties: {
            id: "perm_live",
            sessionID: "ses_live",
            permission: "edit",
            patterns: ["C:/Users/matt/permission-test.txt"],
            metadata: { filepath: "C:/Users/matt/permission-test.txt" },
            always: ["C:/Users/matt/permission-test.txt"],
          },
        }),
      )
      await wait(() => sync.data.permission.ses_live?.length === 1)

      resolvePermission(json([]))
      await wait(() => sync.status === "complete")

      expect(sync.data.permission.ses_live.map((item) => item.id)).toEqual(["perm_live"])
    } finally {
      app.renderer.destroy()
    }
  })

  test("deduplicates live permission requests also present in bootstrap list", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    let resolvePermission!: (response: Response) => void
    const permissionList = new Promise<Response>((resolve) => {
      resolvePermission = resolve
    })
    const request = {
      id: "perm_live",
      sessionID: "ses_live",
      permission: "edit",
      patterns: ["C:/Users/matt/permission-test.txt"],
      metadata: { filepath: "C:/Users/matt/permission-test.txt" },
      always: ["C:/Users/matt/permission-test.txt"],
    }
    const { app, emit, sync } = await mount(
      (url) => {
        if (url.pathname === "/permission") return permissionList
        if (url.pathname === "/question") return json([])
        return undefined
      },
      tmp.path,
      { waitForComplete: false },
    )

    try {
      await Bun.sleep(0)
      emit(
        globalEvent({
          id: "evt_perm_live",
          type: "permission.asked",
          properties: request,
        }),
      )
      await wait(() => sync.data.permission.ses_live?.length === 1)

      resolvePermission(json([request]))
      await wait(() => sync.status === "complete")

      expect(sync.data.permission.ses_live.map((item) => item.id)).toEqual(["perm_live"])
    } finally {
      app.renderer.destroy()
    }
  })

  test("drops pre-existing permission requests missing from bootstrap list", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    let permissionLists = 0
    const { app, emit, sync } = await mount((url) => {
      if (url.pathname === "/permission") {
        permissionLists++
        return json([])
      }
      if (url.pathname === "/question") return json([])
      return undefined
    }, tmp.path)

    try {
      emit(
        globalEvent({
          id: "evt_perm_stale",
          type: "permission.asked",
          properties: {
            id: "perm_stale",
            sessionID: "ses_stale",
            permission: "edit",
            patterns: ["C:/Users/matt/permission-test.txt"],
            metadata: { filepath: "C:/Users/matt/permission-test.txt" },
            always: ["C:/Users/matt/permission-test.txt"],
          },
        }),
      )
      await wait(() => sync.data.permission.ses_stale?.length === 1)

      const beforeReconnect = permissionLists
      emit(
        globalEvent({
          id: "evt_reconnect",
          type: "server.instance.disposed",
          properties: { directory: "/tmp/other" },
        }),
      )
      await wait(() => permissionLists > beforeReconnect)

      expect(sync.data.permission.ses_stale ?? []).toEqual([])
    } finally {
      app.renderer.destroy()
    }
  })
})
