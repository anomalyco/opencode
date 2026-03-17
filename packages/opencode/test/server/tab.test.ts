import { afterEach, describe, expect, test } from "bun:test"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"
import { resetDatabase } from "../fixture/db"

afterEach(async () => {
  await resetDatabase()
})

Log.init({ print: false })

async function jsonPost(app: ReturnType<typeof Server.createApp>, url: string, body?: Record<string, unknown>) {
  const res = await app.request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  })
  const data = await res.json()
  return { res, data }
}

async function jsonGet(app: ReturnType<typeof Server.createApp>, url: string) {
  const res = await app.request(url)
  return { res, data: (await res.json()) as any }
}

async function jsonPatch(app: ReturnType<typeof Server.createApp>, url: string, body: Record<string, unknown>) {
  const res = await app.request(url, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  return { res, data }
}

async function jsonDelete(app: ReturnType<typeof Server.createApp>, url: string) {
  const res = await app.request(url, { method: "DELETE" })
  const data = await res.json()
  return { res, data }
}

describe("tab CRUD lifecycle", () => {
  test("POST /tab creates a tab and returns it with an id", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })

    const { res, data } = await jsonPost(app, `/tab?directory=${tmp.path}`)
    expect(res.status).toBe(200)
    expect(data.id).toBeDefined()
    expect(data.label).toBeDefined()
  })

  test("GET /tab lists tabs (starts with 1 default tab)", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })

    const { data } = await jsonGet(app, `/tab?directory=${tmp.path}`)
    expect(data.tabs).toHaveLength(1)
    expect(data.activeID).toBe(data.tabs[0].id)
    expect(data.position).toBe("bottom")
  })

  test("GET /tab/:id returns a single tab", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })

    const { data: list } = await jsonGet(app, `/tab?directory=${tmp.path}`)
    const id = list.tabs[0].id

    const { res, data } = await jsonGet(app, `/tab/${id}?directory=${tmp.path}`)
    expect(res.status).toBe(200)
    expect(data.id).toBe(id)
  })

  test("DELETE /tab/:id closes a tab", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })

    // Create a second tab so we can delete one
    await jsonPost(app, `/tab?directory=${tmp.path}`)
    const { data: list } = await jsonGet(app, `/tab?directory=${tmp.path}`)
    expect(list.tabs).toHaveLength(2)

    const id = list.tabs[1].id
    const { res } = await jsonDelete(app, `/tab/${id}?directory=${tmp.path}`)
    expect(res.status).toBe(200)

    const { data: after } = await jsonGet(app, `/tab?directory=${tmp.path}`)
    expect(after.tabs).toHaveLength(1)
  })

  test("deleted tab no longer appears in list", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })

    const { data: created } = await jsonPost(app, `/tab?directory=${tmp.path}`)
    const { data: before } = await jsonGet(app, `/tab?directory=${tmp.path}`)
    const ids = before.tabs.map((t: any) => t.id)
    expect(ids).toContain(created.id)

    await jsonDelete(app, `/tab/${before.tabs[0].id}?directory=${tmp.path}`)

    const { data: after } = await jsonGet(app, `/tab?directory=${tmp.path}`)
    const afterIDs = after.tabs.map((t: any) => t.id)
    expect(afterIDs).not.toContain(before.tabs[0].id)
  })

  test("GET /tab/:id returns 404 for deleted tab", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })

    await jsonPost(app, `/tab?directory=${tmp.path}`)
    const { data: list } = await jsonGet(app, `/tab?directory=${tmp.path}`)
    const toDelete = list.tabs[0].id

    await jsonDelete(app, `/tab/${toDelete}?directory=${tmp.path}`)

    const { res } = await jsonGet(app, `/tab/${toDelete}?directory=${tmp.path}`)
    expect(res.status).toBe(404)
  })
})

describe("tab creation options", () => {
  test("create with label", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })

    const { data } = await jsonPost(app, `/tab?directory=${tmp.path}`, { label: "My Tab" })
    expect(data.label).toBe("My Tab")
  })

  test("create with sessionID", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })

    const { data } = await jsonPost(app, `/tab?directory=${tmp.path}`, { sessionID: "ses_abc" })
    expect(data.sessionID).toBe("ses_abc")
    expect(data.route).toEqual({ type: "session", sessionID: "ses_abc" })
  })

  test("create with directory", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })

    const { data } = await jsonPost(app, `/tab?directory=${tmp.path}`, { directory: "/tmp/work" })
    expect(data.directory).toBe("/tmp/work")
  })

  test("create with no body defaults", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })

    const { data } = await jsonPost(app, `/tab?directory=${tmp.path}`)
    expect(data.label).toBe("Untitled")
    expect(data.sessionID).toBeNull()
    expect(data.route).toEqual({ type: "home" })
  })

  test("new tab becomes the active tab", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })

    const { data: created } = await jsonPost(app, `/tab?directory=${tmp.path}`, { label: "New" })
    const { data: list } = await jsonGet(app, `/tab?directory=${tmp.path}`)
    expect(list.activeID).toBe(created.id)
  })
})

describe("tab activation", () => {
  test("POST /tab/:id/activate changes activeID in list", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })

    const { data: list1 } = await jsonGet(app, `/tab?directory=${tmp.path}`)
    const firstID = list1.tabs[0].id

    await jsonPost(app, `/tab?directory=${tmp.path}`, { label: "Second" })

    const { res } = await jsonPost(app, `/tab/${firstID}/activate?directory=${tmp.path}`)
    expect(res.status).toBe(200)

    const { data: list2 } = await jsonGet(app, `/tab?directory=${tmp.path}`)
    expect(list2.activeID).toBe(firstID)
  })

  test("activate non-existent ID returns 404", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })

    const { res } = await jsonPost(app, `/tab/nonexistent/activate?directory=${tmp.path}`)
    expect(res.status).toBe(404)
  })
})

describe("tab update", () => {
  test("PATCH /tab/:id with label renames", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })

    const { data: list } = await jsonGet(app, `/tab?directory=${tmp.path}`)
    const id = list.tabs[0].id

    const { data } = await jsonPatch(app, `/tab/${id}?directory=${tmp.path}`, { label: "Renamed" })
    expect(data.label).toBe("Renamed")
  })

  test("PATCH /tab/:id with sessionID updates session", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })

    const { data: list } = await jsonGet(app, `/tab?directory=${tmp.path}`)
    const id = list.tabs[0].id

    const { data } = await jsonPatch(app, `/tab/${id}?directory=${tmp.path}`, { sessionID: "ses_xyz" })
    expect(data.sessionID).toBe("ses_xyz")
    expect(data.route).toEqual({ type: "session", sessionID: "ses_xyz" })
  })

  test("PATCH /tab/:id with directory updates directory", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })

    const { data: list } = await jsonGet(app, `/tab?directory=${tmp.path}`)
    const id = list.tabs[0].id

    const { data } = await jsonPatch(app, `/tab/${id}?directory=${tmp.path}`, { directory: "/new/dir" })
    expect(data.directory).toBe("/new/dir")
  })
})

describe("tab close behavior", () => {
  test("cannot close last remaining tab", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })

    const { data: list } = await jsonGet(app, `/tab?directory=${tmp.path}`)
    expect(list.tabs).toHaveLength(1)

    // Attempting to close the last tab should not error but tab should remain
    await jsonDelete(app, `/tab/${list.tabs[0].id}?directory=${tmp.path}`)

    const { data: after } = await jsonGet(app, `/tab?directory=${tmp.path}`)
    expect(after.tabs).toHaveLength(1)
  })

  test("closing active tab auto-activates a neighbor", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })

    const { data: list1 } = await jsonGet(app, `/tab?directory=${tmp.path}`)
    const firstID = list1.tabs[0].id

    const { data: second } = await jsonPost(app, `/tab?directory=${tmp.path}`, { label: "Second" })
    // Second tab is now active
    const { data: list2 } = await jsonGet(app, `/tab?directory=${tmp.path}`)
    expect(list2.activeID).toBe(second.id)

    await jsonDelete(app, `/tab/${second.id}?directory=${tmp.path}`)

    const { data: list3 } = await jsonGet(app, `/tab?directory=${tmp.path}`)
    expect(list3.activeID).toBe(firstID)
  })
})

describe("position", () => {
  test("POST /tab/position changes position", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })

    await jsonPost(app, `/tab/position?directory=${tmp.path}`, { position: "top" })

    const { data } = await jsonGet(app, `/tab?directory=${tmp.path}`)
    expect(data.position).toBe("top")
  })

  test("position reflected in GET /tab response", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })

    const { data: before } = await jsonGet(app, `/tab?directory=${tmp.path}`)
    expect(before.position).toBe("bottom")

    await jsonPost(app, `/tab/position?directory=${tmp.path}`, { position: "top" })

    const { data: after } = await jsonGet(app, `/tab?directory=${tmp.path}`)
    expect(after.position).toBe("top")
  })
})

describe("last tab", () => {
  test("POST /tab/last switches to previously active tab", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })

    const { data: list1 } = await jsonGet(app, `/tab?directory=${tmp.path}`)
    const firstID = list1.tabs[0].id

    const { data: second } = await jsonPost(app, `/tab?directory=${tmp.path}`, { label: "Second" })

    await jsonPost(app, `/tab/last?directory=${tmp.path}`)

    const { data: list2 } = await jsonGet(app, `/tab?directory=${tmp.path}`)
    expect(list2.activeID).toBe(firstID)
  })

  test("calling last twice toggles back", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })

    const { data: list1 } = await jsonGet(app, `/tab?directory=${tmp.path}`)
    const firstID = list1.tabs[0].id

    const { data: second } = await jsonPost(app, `/tab?directory=${tmp.path}`, { label: "Second" })

    await jsonPost(app, `/tab/last?directory=${tmp.path}`)
    const { data: list2 } = await jsonGet(app, `/tab?directory=${tmp.path}`)
    expect(list2.activeID).toBe(firstID)

    await jsonPost(app, `/tab/last?directory=${tmp.path}`)
    const { data: list3 } = await jsonGet(app, `/tab?directory=${tmp.path}`)
    expect(list3.activeID).toBe(second.id)
  })
})

describe("tab isolation", () => {
  test("tabs in different directories are independent", async () => {
    await using tmpA = await tmpdir({ git: true })
    await using tmpB = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })

    await jsonPost(app, `/tab?directory=${tmpA.path}`, { label: "Tab A" })
    await jsonPost(app, `/tab?directory=${tmpB.path}`, { label: "Tab B" })

    const { data: listA } = await jsonGet(app, `/tab?directory=${tmpA.path}`)
    const { data: listB } = await jsonGet(app, `/tab?directory=${tmpB.path}`)

    // Each directory has 1 default + 1 created = 2
    expect(listA.tabs).toHaveLength(2)
    expect(listB.tabs).toHaveLength(2)

    const labelsA = listA.tabs.map((t: any) => t.label)
    const labelsB = listB.tabs.map((t: any) => t.label)

    expect(labelsA).toContain("Tab A")
    expect(labelsA).not.toContain("Tab B")
    expect(labelsB).toContain("Tab B")
    expect(labelsB).not.toContain("Tab A")
  })
})
