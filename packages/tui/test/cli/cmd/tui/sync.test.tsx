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

const sessionID = "ses_revert_window"
const session = {
  id: sessionID,
  title: "revert",
  time: { created: 0, updated: 0 },
  version: "1.15.13",
  directory: "/tmp/opencode/packages/tui",
  revert: { messageID: "msg_boundary" },
}
const user = (id: string, created: number) => ({
  id,
  sessionID,
  role: "user" as const,
  agent: "build",
  model: { providerID: "test", modelID: "model" },
  time: { created },
})
const assistant = (id: string, created: number) => ({
  id,
  sessionID,
  role: "assistant" as const,
  agent: "build",
  modelID: "model",
  providerID: "test",
  mode: "build",
  parentID: "msg_boundary",
  path: { cwd: session.directory, root: session.directory },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created, completed: created },
})
const link = (before: string) => `<http://localhost/session/${sessionID}/message?before=${before}>; rel="next"`
const newerLink = (after: string) => `<http://localhost/session/${sessionID}/message?after=${after}>; rel="prev"`

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

  test("revert latest load walks the raw cursor when an older server omits the boundary cursor", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const requests: string[] = []
    const { app, sync } = await mount((url) => {
      requests.push(url.toString())
      if (url.pathname === `/session/${sessionID}`) return json(session)
      if (url.pathname === `/session/${sessionID}/message` && url.searchParams.get("before") === "raw-hidden-older")
        return json([{ info: user("msg_prior", 1), parts: [] }])
      if (url.pathname === `/session/${sessionID}/message`)
        return json([{ info: assistant("msg_newer", 3), parts: [] }], {
          headers: { link: link("raw-hidden-older") },
        })
      if (url.pathname === `/session/${sessionID}/message/msg_boundary`)
        return json({ info: user("msg_boundary", 2), parts: [] })
      if (url.pathname === `/session/${sessionID}/todo` || url.pathname === `/session/${sessionID}/diff`)
        return json([])
      return undefined
    }, tmp.path)

    try {
      await sync.session.sync(sessionID)

      expect(requests.some((url) => new URL(url).searchParams.get("before") === "raw-hidden-older")).toBe(true)
      expect(sync.data.message[sessionID].map((message) => message.id)).toEqual([
        "msg_prior",
        "msg_boundary",
        "msg_newer",
      ])
      expect(sync.data.message_page[sessionID]).toMatchObject({ hasOlder: false, olderCursor: undefined })
    } finally {
      app.renderer.destroy()
    }
  })

  test("revert latest load retains the page cursor when an older server omits the boundary cursor", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const { app, sync } = await mount((url) => {
      if (url.pathname === `/session/${sessionID}`) return json(session)
      if (url.pathname === `/session/${sessionID}/message`)
        return json(
          [
            { info: user("msg_prior", 1), parts: [] },
            { info: assistant("msg_newer", 3), parts: [] },
          ],
          { headers: { link: link("raw-hidden-older") } },
        )
      if (url.pathname === `/session/${sessionID}/message/msg_boundary`)
        return json({ info: user("msg_boundary", 2), parts: [] })
      if (url.pathname === `/session/${sessionID}/todo` || url.pathname === `/session/${sessionID}/diff`)
        return json([])
      return undefined
    }, tmp.path)

    try {
      await sync.session.sync(sessionID)

      expect(sync.data.message[sessionID].map((message) => message.id)).toEqual([
        "msg_prior",
        "msg_boundary",
        "msg_newer",
      ])
      expect(sync.data.message_page[sessionID]).toMatchObject({ hasOlder: true, olderCursor: "raw-hidden-older" })
    } finally {
      app.renderer.destroy()
    }
  })

  test("revert latest load stops when an older server repeats its page", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    let olderRequests = 0
    const { app, sync } = await mount((url) => {
      if (url.pathname === `/session/${sessionID}`) return json(session)
      if (url.pathname === `/session/${sessionID}/message` && url.searchParams.get("before") === "repeat") {
        olderRequests += 1
        return json([{ info: assistant("msg_newer", 3), parts: [] }], { headers: { link: link("repeat") } })
      }
      if (url.pathname === `/session/${sessionID}/message`)
        return json([{ info: assistant("msg_newer", 3), parts: [] }], { headers: { link: link("repeat") } })
      if (url.pathname === `/session/${sessionID}/message/msg_boundary`)
        return json({ info: user("msg_boundary", 2), parts: [] })
      if (url.pathname === `/session/${sessionID}/todo` || url.pathname === `/session/${sessionID}/diff`)
        return json([])
      return undefined
    }, tmp.path)

    try {
      await sync.session.sync(sessionID)

      expect(olderRequests).toBe(1)
      expect(sync.data.message[sessionID]).toBeUndefined()
    } finally {
      app.renderer.destroy()
    }
  })

  test("jump to latest retains the 500 message window", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    let loads = 0
    const { app, sync } = await mount((url) => {
      if (url.pathname === `/session/${sessionID}`) return json({ ...session, revert: undefined })
      if (url.pathname === `/session/${sessionID}/message`) {
        loads += 1
        if (loads === 1)
          return json([{ info: user("msg_old", 0), parts: [] }], {
            headers: { link: newerLink("newer") },
          })
        return json(
          Array.from({ length: 501 }, (_, index) => {
            const id = `msg_${String(index).padStart(3, "0")}`
            return { info: user(id, index + 1), parts: [] }
          }),
        )
      }
      if (url.pathname === `/session/${sessionID}/todo` || url.pathname === `/session/${sessionID}/diff`)
        return json([])
      return undefined
    }, tmp.path)

    try {
      await sync.session.sync(sessionID)
      await sync.session.jumpToLatest(sessionID)

      expect(sync.data.message[sessionID]).toHaveLength(500)
      expect(sync.data.message[sessionID].at(0)?.id).toBe("msg_001")
      expect(sync.data.message[sessionID].at(-1)?.id).toBe("msg_500")
    } finally {
      app.renderer.destroy()
    }
  })

  test("jump to oldest falls back to before paging when an older server rejects oldest", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const { app, sync } = await mount((url) => {
      if (url.pathname === `/session/${sessionID}`) return json({ ...session, revert: undefined })
      if (url.pathname === `/session/${sessionID}/message` && url.searchParams.get("oldest") === "true")
        return json({}, { status: 400 })
      if (url.pathname === `/session/${sessionID}/message` && url.searchParams.get("before") === "older")
        return json([{ info: user("msg_oldest", 1), parts: [] }])
      if (url.pathname === `/session/${sessionID}/message`)
        return json([{ info: user("msg_latest", 2), parts: [] }], { headers: { link: link("older") } })
      if (url.pathname === `/session/${sessionID}/todo` || url.pathname === `/session/${sessionID}/diff`)
        return json([])
      return undefined
    }, tmp.path)

    try {
      await sync.session.sync(sessionID)
      await sync.session.jumpToOldest(sessionID)

      expect(sync.data.message[sessionID].map((message) => message.id)).toEqual(["msg_oldest"])
      expect(sync.data.message_page[sessionID]).toMatchObject({ hasOlder: false, loading: false })
    } finally {
      app.renderer.destroy()
    }
  })

  test("jump to oldest walks before links when an older server ignores oldest", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const { app, sync } = await mount((url) => {
      if (url.pathname === `/session/${sessionID}`) return json({ ...session, revert: undefined })
      if (url.pathname === `/session/${sessionID}/message` && url.searchParams.get("before") === "older")
        return json([{ info: user("msg_oldest", 1), parts: [] }])
      if (url.pathname === `/session/${sessionID}/message`)
        return json([{ info: user("msg_latest", 2), parts: [] }], { headers: { link: link("older") } })
      if (url.pathname === `/session/${sessionID}/todo` || url.pathname === `/session/${sessionID}/diff`)
        return json([])
      return undefined
    }, tmp.path)

    try {
      await sync.session.sync(sessionID)
      await sync.session.jumpToOldest(sessionID)

      expect(sync.data.message[sessionID].map((message) => message.id)).toEqual(["msg_oldest"])
      expect(sync.data.message_page[sessionID]).toMatchObject({ hasOlder: false, loading: false })
    } finally {
      app.renderer.destroy()
    }
  })

  test("jump to oldest does not hide server failures behind compatibility paging", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    let fallbackRequests = 0
    const { app, sync } = await mount((url) => {
      if (url.pathname === `/session/${sessionID}`) return json({ ...session, revert: undefined })
      if (url.pathname === `/session/${sessionID}/message` && url.searchParams.get("oldest") === "true")
        return json({}, { status: 500 })
      if (url.pathname === `/session/${sessionID}/message` && url.searchParams.get("before") === "older") {
        fallbackRequests += 1
        return json([{ info: user("msg_oldest", 1), parts: [] }])
      }
      if (url.pathname === `/session/${sessionID}/message`)
        return json([{ info: user("msg_latest", 2), parts: [] }], { headers: { link: link("older") } })
      if (url.pathname === `/session/${sessionID}/todo` || url.pathname === `/session/${sessionID}/diff`)
        return json([])
      return undefined
    }, tmp.path)

    try {
      await sync.session.sync(sessionID)
      await sync.session.jumpToOldest(sessionID)

      expect(fallbackRequests).toBe(0)
      expect(sync.data.message[sessionID].map((message) => message.id)).toEqual(["msg_latest"])
      expect(sync.data.message_page[sessionID]?.error).toBeTruthy()
    } finally {
      app.renderer.destroy()
    }
  })

  test("load older rejects a repeated page without losing the current window", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    let requests = 0
    const { app, sync } = await mount((url) => {
      if (url.pathname === `/session/${sessionID}`) return json({ ...session, revert: undefined })
      if (url.pathname === `/session/${sessionID}/message`) {
        requests += 1
        return json([{ info: user("msg_latest", 2), parts: [] }], { headers: { link: link("repeat") } })
      }
      if (url.pathname === `/session/${sessionID}/todo` || url.pathname === `/session/${sessionID}/diff`)
        return json([])
      return undefined
    }, tmp.path)

    try {
      await sync.session.sync(sessionID)
      await sync.session.loadOlder(sessionID)

      expect(requests).toBe(2)
      expect(sync.data.message[sessionID].map((message) => message.id)).toEqual(["msg_latest"])
      expect(sync.data.message_page[sessionID]?.error).toBe("Message pagination returned no new messages")
    } finally {
      app.renderer.destroy()
    }
  })

  test("load older keeps unseen messages and closes a repeated cursor", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const { app, sync } = await mount((url) => {
      if (url.pathname === `/session/${sessionID}`) return json({ ...session, revert: undefined })
      if (url.pathname === `/session/${sessionID}/message` && url.searchParams.get("before"))
        return json([{ info: user("msg_older", 1), parts: [] }], { headers: { link: link("repeat") } })
      if (url.pathname === `/session/${sessionID}/message`)
        return json([{ info: user("msg_latest", 2), parts: [] }], { headers: { link: link("repeat") } })
      if (url.pathname === `/session/${sessionID}/todo` || url.pathname === `/session/${sessionID}/diff`)
        return json([])
      return undefined
    }, tmp.path)

    try {
      await sync.session.sync(sessionID)
      await sync.session.loadOlder(sessionID)

      expect(sync.data.message[sessionID].map((message) => message.id)).toEqual(["msg_older", "msg_latest"])
      expect(sync.data.message_page[sessionID]).toMatchObject({ hasOlder: false, olderCursor: undefined })
    } finally {
      app.renderer.destroy()
    }
  })

  test("load newer rejects a repeated page without losing the current window", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    let requests = 0
    const { app, sync } = await mount((url) => {
      if (url.pathname === `/session/${sessionID}`) return json({ ...session, revert: undefined })
      if (url.pathname === `/session/${sessionID}/message`) {
        requests += 1
        return json([{ info: user("msg_oldest", 1), parts: [] }], { headers: { link: newerLink("repeat") } })
      }
      if (url.pathname === `/session/${sessionID}/todo` || url.pathname === `/session/${sessionID}/diff`)
        return json([])
      return undefined
    }, tmp.path)

    try {
      await sync.session.sync(sessionID)
      await sync.session.loadNewer(sessionID)

      expect(requests).toBe(2)
      expect(sync.data.message[sessionID].map((message) => message.id)).toEqual(["msg_oldest"])
      expect(sync.data.message_page[sessionID]?.error).toBe("Message pagination returned no new messages")
    } finally {
      app.renderer.destroy()
    }
  })

  test("load newer keeps unseen messages and closes a repeated cursor", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const { app, sync } = await mount((url) => {
      if (url.pathname === `/session/${sessionID}`) return json({ ...session, revert: undefined })
      if (url.pathname === `/session/${sessionID}/message` && url.searchParams.get("after"))
        return json([{ info: user("msg_newer", 2), parts: [] }], { headers: { link: newerLink("repeat") } })
      if (url.pathname === `/session/${sessionID}/message`)
        return json([{ info: user("msg_oldest", 1), parts: [] }], { headers: { link: newerLink("repeat") } })
      if (url.pathname === `/session/${sessionID}/todo` || url.pathname === `/session/${sessionID}/diff`)
        return json([])
      return undefined
    }, tmp.path)

    try {
      await sync.session.sync(sessionID)
      await sync.session.loadNewer(sessionID)

      expect(sync.data.message[sessionID].map((message) => message.id)).toEqual(["msg_oldest", "msg_newer"])
      expect(sync.data.message_page[sessionID]).toMatchObject({ hasNewer: false, newerCursor: undefined })
    } finally {
      app.renderer.destroy()
    }
  })

  test("all messages rejects repeated cursors without looping", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    let requests = 0
    const { app, sync } = await mount((url) => {
      if (url.pathname !== `/session/${sessionID}/message`) return undefined
      requests += 1
      return json([{ info: user("msg_same", 1), parts: [] }], { headers: { link: link("repeat") } })
    }, tmp.path)

    try {
      await expect(sync.session.allMessages(sessionID)).rejects.toThrow("Message pagination returned no new messages")
      expect(requests).toBe(2)
    } finally {
      app.renderer.destroy()
    }
  })

  test("all messages rejects empty pages that advertise more history", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    let requests = 0
    const { app, sync } = await mount((url) => {
      if (url.pathname !== `/session/${sessionID}/message`) return undefined
      requests += 1
      if (url.searchParams.get("before")) return json([], { headers: { link: link("next") } })
      return json([{ info: user("msg_latest", 2), parts: [] }], { headers: { link: link("first") } })
    }, tmp.path)

    try {
      await expect(sync.session.allMessages(sessionID)).rejects.toThrow("Message pagination returned no new messages")
      expect(requests).toBe(2)
    } finally {
      app.renderer.destroy()
    }
  })

  test("jump to latest preserves cached messages when the latest page fails", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    let loads = 0
    const { app, sync } = await mount((url) => {
      if (url.pathname === `/session/${sessionID}`) return json({ ...session, revert: undefined })
      if (url.pathname === `/session/${sessionID}/message`) {
        loads += 1
        if (loads === 1)
          return json([{ info: user("msg_old", 0), parts: [] }], {
            headers: { link: newerLink("newer") },
          })
        return json({}, { status: 500 })
      }
      if (url.pathname === `/session/${sessionID}/todo` || url.pathname === `/session/${sessionID}/diff`)
        return json([])
      return undefined
    }, tmp.path)

    try {
      await sync.session.sync(sessionID)
      await sync.session.jumpToLatest(sessionID)

      expect(sync.data.message[sessionID].map((message) => message.id)).toEqual(["msg_old"])
      expect(sync.data.message_page[sessionID]).toMatchObject({ loading: false })
    } finally {
      app.renderer.destroy()
    }
  })
})
