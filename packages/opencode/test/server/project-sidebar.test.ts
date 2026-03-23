import { afterEach, describe, expect, test } from "bun:test"
import { GlobalBus } from "../../src/bus/global"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

afterEach(async () => {
  await resetDatabase()
})

describe("project sidebar", () => {
  test("list returns empty initially", async () => {
    await using tmp = await tmpdir()
    const app = Server.Default()
    const res = await app.request("/project/sidebar", {
      headers: { "x-opencode-directory": tmp.path },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  test("open adds a worktree and is idempotent", async () => {
    await using tmp = await tmpdir()
    const app = Server.Default()

    const res1 = await app.request("/project/sidebar/open", {
      method: "POST",
      headers: {
        "x-opencode-directory": tmp.path,
        "content-type": "application/json",
      },
      body: JSON.stringify({ worktree: tmp.path }),
    })
    expect(res1.status).toBe(200)
    const items1 = await res1.json()
    expect(items1).toHaveLength(1)
    expect(items1[0].worktree).toBe(tmp.path)

    // Idempotent: opening same worktree again returns same list
    const res2 = await app.request("/project/sidebar/open", {
      method: "POST",
      headers: {
        "x-opencode-directory": tmp.path,
        "content-type": "application/json",
      },
      body: JSON.stringify({ worktree: tmp.path }),
    })
    expect(res2.status).toBe(200)
    const items2 = await res2.json()
    expect(items2).toHaveLength(1)
  })

  test("two different non-git directories are separate sidebar items", async () => {
    await using dir1 = await tmpdir()
    await using dir2 = await tmpdir()
    const app = Server.Default()

    await app.request("/project/sidebar/open", {
      method: "POST",
      headers: {
        "x-opencode-directory": dir1.path,
        "content-type": "application/json",
      },
      body: JSON.stringify({ worktree: dir1.path }),
    })

    const res = await app.request("/project/sidebar/open", {
      method: "POST",
      headers: {
        "x-opencode-directory": dir1.path,
        "content-type": "application/json",
      },
      body: JSON.stringify({ worktree: dir2.path }),
    })
    const items = await res.json()
    expect(items).toHaveLength(2)
    // Most recent open goes to top
    expect(items[0].worktree).toBe(dir2.path)
    expect(items[1].worktree).toBe(dir1.path)
  })

  test("close removes only the targeted worktree", async () => {
    await using dir1 = await tmpdir()
    await using dir2 = await tmpdir()
    const app = Server.Default()

    await app.request("/project/sidebar/open", {
      method: "POST",
      headers: {
        "x-opencode-directory": dir1.path,
        "content-type": "application/json",
      },
      body: JSON.stringify({ worktree: dir1.path }),
    })
    await app.request("/project/sidebar/open", {
      method: "POST",
      headers: {
        "x-opencode-directory": dir1.path,
        "content-type": "application/json",
      },
      body: JSON.stringify({ worktree: dir2.path }),
    })

    const res = await app.request("/project/sidebar/close", {
      method: "POST",
      headers: {
        "x-opencode-directory": dir1.path,
        "content-type": "application/json",
      },
      body: JSON.stringify({ worktree: dir1.path }),
    })
    expect(res.status).toBe(200)
    const items = await res.json()
    expect(items).toHaveLength(1)
    expect(items[0].worktree).toBe(dir2.path)
  })

  test("reorder persists exact order", async () => {
    await using dir1 = await tmpdir()
    await using dir2 = await tmpdir()
    await using dir3 = await tmpdir()
    const app = Server.Default()

    const res = await app.request("/project/sidebar/reorder", {
      method: "POST",
      headers: {
        "x-opencode-directory": dir1.path,
        "content-type": "application/json",
      },
      body: JSON.stringify({ worktrees: [dir3.path, dir1.path, dir2.path] }),
    })
    expect(res.status).toBe(200)
    const items = await res.json()
    expect(items).toHaveLength(3)
    expect(items[0].worktree).toBe(dir3.path)
    expect(items[1].worktree).toBe(dir1.path)
    expect(items[2].worktree).toBe(dir2.path)

    // Verify persistence with a fresh list call
    const list = await app.request("/project/sidebar", {
      headers: { "x-opencode-directory": dir1.path },
    })
    const persisted = await list.json()
    expect(persisted.map((x: any) => x.worktree)).toEqual([dir3.path, dir1.path, dir2.path])
  })

  test("mutations emit project.sidebar.updated", async () => {
    await using tmp = await tmpdir()
    const app = Server.Default()
    const events: { payload: { type: string } }[] = []
    const handler = (evt: { payload: { type: string } }) => {
      events.push(evt)
    }
    GlobalBus.on("event", handler)

    try {
      await app.request("/project/sidebar/open", {
        method: "POST",
        headers: {
          "x-opencode-directory": tmp.path,
          "content-type": "application/json",
        },
        body: JSON.stringify({ worktree: tmp.path }),
      })
      expect(events.some((e) => e.payload.type === "project.sidebar.updated")).toBe(true)

      events.length = 0
      await app.request("/project/sidebar/close", {
        method: "POST",
        headers: {
          "x-opencode-directory": tmp.path,
          "content-type": "application/json",
        },
        body: JSON.stringify({ worktree: tmp.path }),
      })
      expect(events.some((e) => e.payload.type === "project.sidebar.updated")).toBe(true)

      events.length = 0
      await app.request("/project/sidebar/reorder", {
        method: "POST",
        headers: {
          "x-opencode-directory": tmp.path,
          "content-type": "application/json",
        },
        body: JSON.stringify({ worktrees: [tmp.path] }),
      })
      expect(events.some((e) => e.payload.type === "project.sidebar.updated")).toBe(true)
    } finally {
      GlobalBus.off("event", handler)
    }
  })
})
