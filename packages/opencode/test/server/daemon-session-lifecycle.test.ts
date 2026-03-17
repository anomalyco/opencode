import { afterEach, describe, expect, test } from "bun:test"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"
import { resetDatabase } from "../fixture/db"

afterEach(async () => {
  await resetDatabase()
})

Log.init({ print: false })

async function jsonGet(app: ReturnType<typeof Server.createApp>, url: string) {
  const res = await app.request(url)
  return (await res.json()) as any
}

async function jsonPost(app: ReturnType<typeof Server.createApp>, url: string, body?: Record<string, unknown>) {
  const res = await app.request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  })
  const data = await res.json()
  return { res, data }
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

describe("session archiving through daemon API", () => {
  test("archived session excluded from experimental list but accessible by ID", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })

    const { data: s1 } = await jsonPost(app, `/session?directory=${tmp.path}`)
    const { data: s2 } = await jsonPost(app, `/session?directory=${tmp.path}`)

    await jsonPatch(app, `/session/${s1.id}?directory=${tmp.path}`, { time: { archived: Date.now() } })

    // Standard list still returns it
    const standardList = await jsonGet(app, `/session?directory=${tmp.path}`)
    const standardIds = standardList.map((s: any) => s.id)
    expect(standardIds).toContain(s1.id)
    expect(standardIds).toContain(s2.id)

    // Experimental list excludes it
    const expList = await jsonGet(app, `/experimental/session?directory=${tmp.path}`)
    const expIds = expList.map((s: any) => s.id)
    expect(expIds).not.toContain(s1.id)
    expect(expIds).toContain(s2.id)

    // Direct GET by ID still works
    const fetched = await app.request(`/session/${s1.id}?directory=${tmp.path}`)
    expect(fetched.status).toBe(200)
    const body = await fetched.json()
    expect(body.id).toBe(s1.id)
    expect(body.time.archived).toBeDefined()
  })

  test("archived: 0 still counts as archived (only null clears)", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })

    const { data: s1 } = await jsonPost(app, `/session?directory=${tmp.path}`)

    await jsonPatch(app, `/session/${s1.id}?directory=${tmp.path}`, { time: { archived: Date.now() } })
    await jsonPatch(app, `/session/${s1.id}?directory=${tmp.path}`, { time: { archived: 0 } })

    // archived: 0 sets time_archived = 0 which is NOT null, so session stays hidden
    const expList = await jsonGet(app, `/experimental/session?directory=${tmp.path}`)
    expect(expList.map((s: any) => s.id)).not.toContain(s1.id)
  })

  test("un-archiving a session makes it visible again in experimental list", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })

    const { data: s1 } = await jsonPost(app, `/session?directory=${tmp.path}`)

    // Archive
    await jsonPatch(app, `/session/${s1.id}?directory=${tmp.path}`, { time: { archived: Date.now() } })
    const archived = await jsonGet(app, `/experimental/session?directory=${tmp.path}`)
    expect(archived.map((s: any) => s.id)).not.toContain(s1.id)

    // Un-archive by sending time with no archived key (sets time_archived = null)
    await jsonPatch(app, `/session/${s1.id}?directory=${tmp.path}`, { time: {} })
    const unarchived = await jsonGet(app, `/experimental/session?directory=${tmp.path}`)
    expect(unarchived.map((s: any) => s.id)).toContain(s1.id)
  })
})

describe("session forking preserves daemon metadata", () => {
  test("forked session inherits parent title but not daemon-specific fields", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })

    const { data: parent } = await jsonPost(app, `/session?directory=${tmp.path}`, {
      displayName: "Parent Task",
      gitBranch: "feat/parent",
      gitWorktree: "/tmp/parent-wt",
      prReference: "PR #10",
      providerID: "anthropic",
      modelID: "claude-4",
    })

    const { res: forkRes, data: forked } = await jsonPost(app, `/session/${parent.id}/fork?directory=${tmp.path}`, {})
    expect(forkRes.status).toBe(200)
    expect(forked.id).not.toBe(parent.id)
    expect(forked.title).toContain("(fork")

    // Fork copies messages but creates a new independent session.
    // Daemon-specific metadata is NOT inherited by fork.
    expect(forked.parentID).toBeUndefined()
    expect(forked.displayName).toBeUndefined()
    expect(forked.gitBranch).toBeUndefined()
    expect(forked.gitWorktree).toBeUndefined()
    expect(forked.prReference).toBeUndefined()
  })
})

describe("session metadata field interactions", () => {
  test("PATCH title does not affect displayName", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })

    const { data: s1 } = await jsonPost(app, `/session?directory=${tmp.path}`, {
      displayName: "Original Name",
    })
    expect(s1.displayName).toBe("Original Name")

    const { data: updated } = await jsonPatch(app, `/session/${s1.id}?directory=${tmp.path}`, {
      title: "New Title",
    })
    expect(updated.title).toBe("New Title")
    expect(updated.displayName).toBe("Original Name")
  })

  test("session slug is stable across updates", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })

    const { data: s1 } = await jsonPost(app, `/session?directory=${tmp.path}`)
    const originalSlug = s1.slug

    await jsonPatch(app, `/session/${s1.id}?directory=${tmp.path}`, { title: "Changed Title" })

    const refetched = await jsonGet(app, `/session/${s1.id}?directory=${tmp.path}`)
    expect(refetched.slug).toBe(originalSlug)
  })

  test("session with all metadata fields round-trips through list endpoint", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })

    const metadata = {
      providerID: "openai",
      modelID: "gpt-4o",
      gitBranch: "main",
      gitWorktree: "/tmp/wt-main",
      displayName: "Main Task",
      prReference: "PR #99",
    }
    const { data: created } = await jsonPost(app, `/session?directory=${tmp.path}`, metadata)

    const list = await jsonGet(app, `/session?directory=${tmp.path}`)
    const found = list.find((s: any) => s.id === created.id)
    expect(found).toBeDefined()
    expect(found.providerID).toBe(metadata.providerID)
    expect(found.modelID).toBe(metadata.modelID)
    expect(found.gitBranch).toBe(metadata.gitBranch)
    expect(found.gitWorktree).toBe(metadata.gitWorktree)
    expect(found.displayName).toBe(metadata.displayName)
    expect(found.prReference).toBe(metadata.prReference)
  })
})

describe("session deletion edge cases", () => {
  test("deleting a non-existent session is silently idempotent", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })

    // Delete swallows NotFoundError — returns 200 regardless
    const res = await app.request(`/session/ses_nonexistent?directory=${tmp.path}`, { method: "DELETE" })
    expect(res.status).toBe(200)
  })

  test("double-delete is silently idempotent", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })

    const { data: s1 } = await jsonPost(app, `/session?directory=${tmp.path}`)

    const first = await app.request(`/session/${s1.id}?directory=${tmp.path}`, { method: "DELETE" })
    expect(first.status).toBe(200)

    // Second delete also succeeds (idempotent)
    const second = await app.request(`/session/${s1.id}?directory=${tmp.path}`, { method: "DELETE" })
    expect(second.status).toBe(200)
  })

  test("GET deleted session returns 404", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })

    const { data: s1 } = await jsonPost(app, `/session?directory=${tmp.path}`)
    await app.request(`/session/${s1.id}?directory=${tmp.path}`, { method: "DELETE" })

    const res = await app.request(`/session/${s1.id}?directory=${tmp.path}`)
    expect(res.status).toBe(404)
  })
})

describe("global health and dispose endpoints", () => {
  test("global health returns healthy with version", async () => {
    const app = Server.createApp({ daemon: true })
    const res = await app.request("/global/health")
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.healthy).toBe(true)
    expect(body.version).toBeDefined()
    expect(typeof body.version).toBe("string")
  })

  test("global config returns config object", async () => {
    const app = Server.createApp({ daemon: true })
    const res = await app.request("/global/config")
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(typeof body).toBe("object")
  })
})

describe("daemon mode directory edge cases", () => {
  test("directory with special characters in path", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })

    // URL-encode the path
    const encoded = encodeURIComponent(tmp.path)
    const res = await app.request(`/session?directory=${encoded}`)
    expect(res.status).not.toBe(400)
  })

  test("multiple directories can be used in same request sequence", async () => {
    await using tmpA = await tmpdir({ git: true })
    await using tmpB = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })

    const { data: sA } = await jsonPost(app, `/session?directory=${tmpA.path}`)
    const { data: sB } = await jsonPost(app, `/session?directory=${tmpB.path}`)

    // Fetch session from dir A using dir A
    const fetchA = await app.request(`/session/${sA.id}?directory=${tmpA.path}`)
    expect(fetchA.status).toBe(200)

    // Fetch session from dir B using dir B
    const fetchB = await app.request(`/session/${sB.id}?directory=${tmpB.path}`)
    expect(fetchB.status).toBe(200)
  })

  test("session created in one directory not visible in another", async () => {
    await using tmpA = await tmpdir({ git: true })
    await using tmpB = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })

    await jsonPost(app, `/session?directory=${tmpA.path}`)

    const listB = await jsonGet(app, `/session?directory=${tmpB.path}`)
    expect(listB).toHaveLength(0)
  })
})

describe("concurrent session creation stress", () => {
  test("10 concurrent sessions in same directory all succeed", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })

    const results = await Promise.all(Array.from({ length: 10 }, () => jsonPost(app, `/session?directory=${tmp.path}`)))

    for (const { res } of results) {
      expect(res.status).toBe(200)
    }

    const list = await jsonGet(app, `/session?directory=${tmp.path}`)
    expect(list).toHaveLength(10)

    // All IDs should be unique
    const ids = new Set(list.map((s: any) => s.id))
    expect(ids.size).toBe(10)
  })
})
