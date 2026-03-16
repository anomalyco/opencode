import { afterEach, describe, expect, test } from "bun:test"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"
import { resetDatabase } from "../fixture/db"
import * as fs from "fs/promises"
import path from "path"

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

async function jsonPatch(app: ReturnType<typeof Server.createApp>, url: string, body: Record<string, unknown>) {
  const res = await app.request(url, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  return { res, data }
}

async function jsonGet(app: ReturnType<typeof Server.createApp>, url: string) {
  const res = await app.request(url)
  return (await res.json()) as any
}

// Simulate TUI KV file writes
async function writeKV(kvPath: string, key: string, sessionIDs: string[]) {
  let store: Record<string, unknown> = {}
  try {
    store = JSON.parse(await fs.readFile(kvPath, "utf-8"))
  } catch {}
  store[key] = sessionIDs
  await fs.writeFile(kvPath, JSON.stringify(store))
}

async function readKV(kvPath: string, key: string): Promise<string[]> {
  try {
    const store = JSON.parse(await fs.readFile(kvPath, "utf-8"))
    return store[key] ?? []
  } catch {
    return []
  }
}

// Replicates the exact algorithm from app.tsx:400-412
function reconstructTabs(
  savedIDs: string[],
  sessions: Array<{ id: string; slug: string; displayName?: string; directory: string; gitWorktree?: string }>,
) {
  const tabs: Array<{ sessionID: string; label: string; directory: string }> = []
  for (const sessionID of savedIDs) {
    const session = sessions.find((s) => s.id === sessionID)
    if (!session) continue
    tabs.push({
      sessionID,
      label: session.displayName ?? session.slug,
      directory: session.gitWorktree ?? session.directory,
    })
  }
  return tabs
}

describe("basic tab persistence and reconnection", () => {
  test("create sessions, save to KV, reconnect, verify all tabs restored", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })
    const kvPath = path.join(tmp.path, "kv.json")
    const kvKey = "daemon_tabs_test"

    const { data: s1 } = await jsonPost(app, `/session?directory=${tmp.path}`)
    const { data: s2 } = await jsonPost(app, `/session?directory=${tmp.path}`)

    await writeKV(kvPath, kvKey, [s1.id, s2.id])

    const savedIDs = await readKV(kvPath, kvKey)
    const sessions = await jsonGet(app, `/session?directory=${tmp.path}`)
    const tabs = reconstructTabs(savedIDs, sessions)

    expect(tabs).toHaveLength(2)
    expect(tabs[0].sessionID).toBe(s1.id)
    expect(tabs[1].sessionID).toBe(s2.id)
  })

  test("empty KV produces no tabs on reconnect", async () => {
    await using tmp = await tmpdir({ git: true })
    const kvPath = path.join(tmp.path, "kv.json")
    const kvKey = "daemon_tabs_test"

    const savedIDs = await readKV(kvPath, kvKey)
    const tabs = reconstructTabs(savedIDs, [])

    expect(tabs).toHaveLength(0)
  })

  test("single tab round-trips correctly", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })
    const kvPath = path.join(tmp.path, "kv.json")
    const kvKey = "daemon_tabs_test"

    const { data: s1 } = await jsonPost(app, `/session?directory=${tmp.path}`)

    await writeKV(kvPath, kvKey, [s1.id])

    const savedIDs = await readKV(kvPath, kvKey)
    const sessions = await jsonGet(app, `/session?directory=${tmp.path}`)
    const tabs = reconstructTabs(savedIDs, sessions)

    expect(tabs).toHaveLength(1)
    expect(tabs[0].sessionID).toBe(s1.id)
    expect(tabs[0].label).toBe(s1.slug)
    expect(tabs[0].directory).toBe(s1.directory)
  })
})

describe("tab labels use displayName when set, slug otherwise", () => {
  test("session with displayName uses displayName as label", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })
    const kvPath = path.join(tmp.path, "kv.json")
    const kvKey = "daemon_tabs_test"

    const { data: s1 } = await jsonPost(app, `/session?directory=${tmp.path}`, { displayName: "My Feature" })

    await writeKV(kvPath, kvKey, [s1.id])

    const savedIDs = await readKV(kvPath, kvKey)
    const sessions = await jsonGet(app, `/session?directory=${tmp.path}`)
    const tabs = reconstructTabs(savedIDs, sessions)

    expect(tabs).toHaveLength(1)
    expect(tabs[0].label).toBe("My Feature")
  })

  test("session without displayName uses slug as label", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })
    const kvPath = path.join(tmp.path, "kv.json")
    const kvKey = "daemon_tabs_test"

    const { data: s1 } = await jsonPost(app, `/session?directory=${tmp.path}`)

    await writeKV(kvPath, kvKey, [s1.id])

    const savedIDs = await readKV(kvPath, kvKey)
    const sessions = await jsonGet(app, `/session?directory=${tmp.path}`)
    const tabs = reconstructTabs(savedIDs, sessions)

    expect(tabs).toHaveLength(1)
    expect(tabs[0].label).toBe(s1.slug)
  })

  test("mixed sessions: some with displayName, some without", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })
    const kvPath = path.join(tmp.path, "kv.json")
    const kvKey = "daemon_tabs_test"

    const { data: s1 } = await jsonPost(app, `/session?directory=${tmp.path}`, { displayName: "Named One" })
    const { data: s2 } = await jsonPost(app, `/session?directory=${tmp.path}`)
    const { data: s3 } = await jsonPost(app, `/session?directory=${tmp.path}`, { displayName: "Named Three" })

    await writeKV(kvPath, kvKey, [s1.id, s2.id, s3.id])

    const savedIDs = await readKV(kvPath, kvKey)
    const sessions = await jsonGet(app, `/session?directory=${tmp.path}`)
    const tabs = reconstructTabs(savedIDs, sessions)

    expect(tabs).toHaveLength(3)
    expect(tabs[0].label).toBe("Named One")
    expect(tabs[1].label).toBe(s2.slug)
    expect(tabs[2].label).toBe("Named Three")
  })
})

describe("title rename does not affect reconnected tab label", () => {
  test("PATCH title does NOT change tab label on reconnect", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })
    const kvPath = path.join(tmp.path, "kv.json")
    const kvKey = "daemon_tabs_test"

    const { data: s1 } = await jsonPost(app, `/session?directory=${tmp.path}`)
    await jsonPatch(app, `/session/${s1.id}?directory=${tmp.path}`, { title: "Renamed" })

    await writeKV(kvPath, kvKey, [s1.id])

    const savedIDs = await readKV(kvPath, kvKey)
    const sessions = await jsonGet(app, `/session?directory=${tmp.path}`)
    const tabs = reconstructTabs(savedIDs, sessions)

    expect(tabs).toHaveLength(1)
    // Title rename doesn't affect displayName, so label falls back to slug
    expect(tabs[0].label).toBe(s1.slug)
    expect(tabs[0].label).not.toBe("Renamed")
  })

  test("session with displayName keeps label even when title is patched", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })
    const kvPath = path.join(tmp.path, "kv.json")
    const kvKey = "daemon_tabs_test"

    const { data: s1 } = await jsonPost(app, `/session?directory=${tmp.path}`, { displayName: "My Task" })
    await jsonPatch(app, `/session/${s1.id}?directory=${tmp.path}`, { title: "Different Title" })

    await writeKV(kvPath, kvKey, [s1.id])

    const savedIDs = await readKV(kvPath, kvKey)
    const sessions = await jsonGet(app, `/session?directory=${tmp.path}`)
    const tabs = reconstructTabs(savedIDs, sessions)

    expect(tabs).toHaveLength(1)
    expect(tabs[0].label).toBe("My Task")
  })
})

describe("deleted sessions are skipped on reconnect", () => {
  test("deleted session is skipped, remaining tabs preserved", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })
    const kvPath = path.join(tmp.path, "kv.json")
    const kvKey = "daemon_tabs_test"

    const { data: s1 } = await jsonPost(app, `/session?directory=${tmp.path}`)
    const { data: s2 } = await jsonPost(app, `/session?directory=${tmp.path}`)
    const { data: s3 } = await jsonPost(app, `/session?directory=${tmp.path}`)

    await writeKV(kvPath, kvKey, [s1.id, s2.id, s3.id])

    await app.request(`/session/${s2.id}?directory=${tmp.path}`, { method: "DELETE" })

    const savedIDs = await readKV(kvPath, kvKey)
    const sessions = await jsonGet(app, `/session?directory=${tmp.path}`)
    const tabs = reconstructTabs(savedIDs, sessions)

    expect(tabs).toHaveLength(2)
    expect(tabs[0].sessionID).toBe(s1.id)
    expect(tabs[1].sessionID).toBe(s3.id)
  })

  test("all sessions deleted produces no tabs", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })
    const kvPath = path.join(tmp.path, "kv.json")
    const kvKey = "daemon_tabs_test"

    const { data: s1 } = await jsonPost(app, `/session?directory=${tmp.path}`)
    const { data: s2 } = await jsonPost(app, `/session?directory=${tmp.path}`)

    await writeKV(kvPath, kvKey, [s1.id, s2.id])

    await app.request(`/session/${s1.id}?directory=${tmp.path}`, { method: "DELETE" })
    await app.request(`/session/${s2.id}?directory=${tmp.path}`, { method: "DELETE" })

    const savedIDs = await readKV(kvPath, kvKey)
    const sessions = await jsonGet(app, `/session?directory=${tmp.path}`)
    const tabs = reconstructTabs(savedIDs, sessions)

    expect(tabs).toHaveLength(0)
  })

  test("stale ID in KV is skipped", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })
    const kvPath = path.join(tmp.path, "kv.json")
    const kvKey = "daemon_tabs_test"

    await writeKV(kvPath, kvKey, ["ses_fabricated_nonexistent_id"])

    const savedIDs = await readKV(kvPath, kvKey)
    const sessions = await jsonGet(app, `/session?directory=${tmp.path}`)
    const tabs = reconstructTabs(savedIDs, sessions)

    expect(tabs).toHaveLength(0)
  })
})

describe("tab order preservation", () => {
  test("tabs restored in saved order", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })
    const kvPath = path.join(tmp.path, "kv.json")
    const kvKey = "daemon_tabs_test"

    const { data: s1 } = await jsonPost(app, `/session?directory=${tmp.path}`)
    const { data: s2 } = await jsonPost(app, `/session?directory=${tmp.path}`)
    const { data: s3 } = await jsonPost(app, `/session?directory=${tmp.path}`)

    // Save in non-creation order
    await writeKV(kvPath, kvKey, [s2.id, s3.id, s1.id])

    const savedIDs = await readKV(kvPath, kvKey)
    const sessions = await jsonGet(app, `/session?directory=${tmp.path}`)
    const tabs = reconstructTabs(savedIDs, sessions)

    expect(tabs).toHaveLength(3)
    expect(tabs[0].sessionID).toBe(s2.id)
    expect(tabs[1].sessionID).toBe(s3.id)
    expect(tabs[2].sessionID).toBe(s1.id)
  })

  test("order preserved when some sessions deleted", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })
    const kvPath = path.join(tmp.path, "kv.json")
    const kvKey = "daemon_tabs_test"

    const { data: s1 } = await jsonPost(app, `/session?directory=${tmp.path}`)
    const { data: s2 } = await jsonPost(app, `/session?directory=${tmp.path}`)
    const { data: s3 } = await jsonPost(app, `/session?directory=${tmp.path}`)

    await writeKV(kvPath, kvKey, [s1.id, s2.id, s3.id])

    await app.request(`/session/${s2.id}?directory=${tmp.path}`, { method: "DELETE" })

    const savedIDs = await readKV(kvPath, kvKey)
    const sessions = await jsonGet(app, `/session?directory=${tmp.path}`)
    const tabs = reconstructTabs(savedIDs, sessions)

    expect(tabs).toHaveLength(2)
    expect(tabs[0].sessionID).toBe(s1.id)
    expect(tabs[1].sessionID).toBe(s3.id)
  })
})

describe("directory and worktree in tab reconstruction", () => {
  test("tab uses session.directory when no gitWorktree", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })
    const kvPath = path.join(tmp.path, "kv.json")
    const kvKey = "daemon_tabs_test"

    const { data: s1 } = await jsonPost(app, `/session?directory=${tmp.path}`)

    await writeKV(kvPath, kvKey, [s1.id])

    const savedIDs = await readKV(kvPath, kvKey)
    const sessions = await jsonGet(app, `/session?directory=${tmp.path}`)
    const tabs = reconstructTabs(savedIDs, sessions)

    expect(tabs).toHaveLength(1)
    expect(tabs[0].directory).toBe(s1.directory)
  })

  test("tab uses gitWorktree when set", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })
    const kvPath = path.join(tmp.path, "kv.json")
    const kvKey = "daemon_tabs_test"

    const { data: s1 } = await jsonPost(app, `/session?directory=${tmp.path}`, {
      gitWorktree: "/tmp/my-worktree",
    })

    await writeKV(kvPath, kvKey, [s1.id])

    const savedIDs = await readKV(kvPath, kvKey)
    const sessions = await jsonGet(app, `/session?directory=${tmp.path}`)
    const tabs = reconstructTabs(savedIDs, sessions)

    expect(tabs).toHaveLength(1)
    expect(tabs[0].directory).toBe("/tmp/my-worktree")
  })
})

describe("archived sessions on reconnect", () => {
  test("archived session still appears in standard list and restores on reconnect", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })
    const kvPath = path.join(tmp.path, "kv.json")
    const kvKey = "daemon_tabs_test"

    const { data: s1 } = await jsonPost(app, `/session?directory=${tmp.path}`)
    const { data: s2 } = await jsonPost(app, `/session?directory=${tmp.path}`)

    await writeKV(kvPath, kvKey, [s1.id, s2.id])

    // Archive s1
    await jsonPatch(app, `/session/${s1.id}?directory=${tmp.path}`, { time: { archived: Date.now() } })

    const savedIDs = await readKV(kvPath, kvKey)

    // The standard /session endpoint does NOT filter archived sessions,
    // so the reconnect algorithm (which uses sync.data.session, backed by /session)
    // will still find archived sessions.
    const sessions = await jsonGet(app, `/session?directory=${tmp.path}`)
    expect(sessions.map((s: any) => s.id)).toContain(s1.id)

    const tabs = reconstructTabs(savedIDs, sessions)

    // Archiving != deleting — both tabs should still be restored
    expect(tabs).toHaveLength(2)
    expect(tabs[0].sessionID).toBe(s1.id)
    expect(tabs[1].sessionID).toBe(s2.id)
  })
})
