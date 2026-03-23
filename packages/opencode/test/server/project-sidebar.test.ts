import { afterEach, describe, expect, test } from "bun:test"
import { GlobalBus } from "../../src/bus/global"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

type Item = { worktree: string; sort_order: number }

afterEach(async () => {
  await resetDatabase()
})

function request(app: ReturnType<typeof Server.Default>, path: string, opts?: RequestInit & { dir?: string }) {
  return app.request(path, {
    ...opts,
    headers: {
      "x-opencode-directory": opts?.dir ?? "/tmp",
      ...(opts?.headers ?? {}),
    },
  })
}

function post(app: ReturnType<typeof Server.Default>, path: string, body: unknown, dir?: string) {
  return request(app, path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    dir,
  })
}

describe("project sidebar", () => {
  test("list returns empty initially", async () => {
    await using tmp = await tmpdir()
    const app = Server.Default()
    const res = await request(app, "/project/sidebar", { dir: tmp.path })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  test("open adds a worktree and is idempotent", async () => {
    await using tmp = await tmpdir()
    const app = Server.Default()

    const res1 = await post(app, "/project/sidebar/open", { worktree: tmp.path }, tmp.path)
    expect(res1.status).toBe(200)
    const items1: Item[] = await res1.json()
    expect(items1).toHaveLength(1)
    expect(items1[0].worktree).toBe(tmp.path)

    const res2 = await post(app, "/project/sidebar/open", { worktree: tmp.path }, tmp.path)
    expect(res2.status).toBe(200)
    const items2: Item[] = await res2.json()
    expect(items2).toHaveLength(1)
  })

  test("two different non-git directories are separate sidebar items", async () => {
    await using dir1 = await tmpdir()
    await using dir2 = await tmpdir()
    const app = Server.Default()

    await post(app, "/project/sidebar/open", { worktree: dir1.path }, dir1.path)
    const res = await post(app, "/project/sidebar/open", { worktree: dir2.path }, dir1.path)
    const items: Item[] = await res.json()
    expect(items).toHaveLength(2)
    expect(items[0].worktree).toBe(dir2.path)
    expect(items[1].worktree).toBe(dir1.path)
  })

  test("trailing slash variant resolves to the same item", async () => {
    await using tmp = await tmpdir()
    const app = Server.Default()

    await post(app, "/project/sidebar/open", { worktree: tmp.path }, tmp.path)
    const res = await post(app, "/project/sidebar/open", { worktree: tmp.path + "/" }, tmp.path)
    const items: Item[] = await res.json()
    expect(items).toHaveLength(1)
    expect(items[0].worktree).toBe(tmp.path)
  })

  test("close removes only the targeted worktree", async () => {
    await using dir1 = await tmpdir()
    await using dir2 = await tmpdir()
    const app = Server.Default()

    await post(app, "/project/sidebar/open", { worktree: dir1.path }, dir1.path)
    await post(app, "/project/sidebar/open", { worktree: dir2.path }, dir1.path)

    const res = await post(app, "/project/sidebar/close", { worktree: dir1.path }, dir1.path)
    expect(res.status).toBe(200)
    const items: Item[] = await res.json()
    expect(items).toHaveLength(1)
    expect(items[0].worktree).toBe(dir2.path)
    expect(items[0].sort_order).toBe(0)
  })

  test("close with trailing slash variant targets the same item", async () => {
    await using tmp = await tmpdir()
    const app = Server.Default()

    await post(app, "/project/sidebar/open", { worktree: tmp.path }, tmp.path)
    const res = await post(app, "/project/sidebar/close", { worktree: tmp.path + "/" }, tmp.path)
    const items: Item[] = await res.json()
    expect(items).toHaveLength(0)
  })

  test("reorder persists exact order", async () => {
    await using dir1 = await tmpdir()
    await using dir2 = await tmpdir()
    await using dir3 = await tmpdir()
    const app = Server.Default()

    const res = await post(app, "/project/sidebar/reorder", { worktrees: [dir3.path, dir1.path, dir2.path] }, dir1.path)
    expect(res.status).toBe(200)
    const items: Item[] = await res.json()
    expect(items).toHaveLength(3)
    expect(items[0].worktree).toBe(dir3.path)
    expect(items[1].worktree).toBe(dir1.path)
    expect(items[2].worktree).toBe(dir2.path)

    const list = await request(app, "/project/sidebar", { dir: dir1.path })
    const persisted: Item[] = await list.json()
    expect(persisted.map((x) => x.worktree)).toEqual([dir3.path, dir1.path, dir2.path])
  })

  test("reorder deduplicates normalized path variants", async () => {
    await using tmp = await tmpdir()
    const app = Server.Default()

    const res = await post(app, "/project/sidebar/reorder", { worktrees: [tmp.path, tmp.path + "/"] }, tmp.path)
    const items: Item[] = await res.json()
    expect(items).toHaveLength(1)
    expect(items[0].worktree).toBe(tmp.path)
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
      await post(app, "/project/sidebar/open", { worktree: tmp.path }, tmp.path)
      expect(events.some((e) => e.payload.type === "project.sidebar.updated")).toBe(true)

      events.length = 0
      await post(app, "/project/sidebar/close", { worktree: tmp.path }, tmp.path)
      expect(events.some((e) => e.payload.type === "project.sidebar.updated")).toBe(true)

      events.length = 0
      await post(app, "/project/sidebar/reorder", { worktrees: [tmp.path] }, tmp.path)
      expect(events.some((e) => e.payload.type === "project.sidebar.updated")).toBe(true)
    } finally {
      GlobalBus.off("event", handler)
    }
  })
})
