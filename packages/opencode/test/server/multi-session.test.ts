import { afterEach, describe, expect, test } from "bun:test"
import { Server } from "../../src/server/server"
import { GlobalRoutes } from "../../src/server/routes/global"
import { GlobalBus } from "../../src/bus/global"
import { parseSSE } from "../../src/control-plane/sse"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"
import { resetDatabase } from "../fixture/db"

afterEach(async () => {
  await resetDatabase()
})

Log.init({ print: false })

type SSEEvent = { directory?: string; payload: { type: string; properties: Record<string, unknown> } }

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

async function collectSSE(
  app: ReturnType<typeof GlobalRoutes>,
  query: string,
  emitFn: () => void,
  opts?: { collectCount?: number },
) {
  const stop = new AbortController()
  const seen: unknown[] = []
  const collectCount = opts?.collectCount ?? 1

  try {
    const response = await app.request(`/event${query}`, { signal: stop.signal })
    expect(response.status).toBe(200)
    expect(response.body).toBeDefined()

    const done = new Promise<void>((resolve) => {
      const timeout = setTimeout(() => resolve(), 3000)
      let emitted = false
      void parseSSE(response.body!, stop.signal, (event) => {
        const e = event as { payload?: { type?: string } }
        if (e.payload?.type === "server.connected") {
          if (!emitted) {
            emitted = true
            setTimeout(emitFn, 50)
          }
          return
        }
        seen.push(e)
        if (seen.length >= collectCount) {
          clearTimeout(timeout)
          resolve()
        }
      }).catch(() => {})
    })

    await done
    return seen
  } finally {
    stop.abort()
  }
}

describe("session isolation across directories", () => {
  test("sessions in different directories are independent", async () => {
    await using tmpA = await tmpdir({ git: true })
    await using tmpB = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })

    const { data: sessionA } = await jsonPost(app, `/session?directory=${tmpA.path}`)
    const { data: sessionB } = await jsonPost(app, `/session?directory=${tmpB.path}`)

    const listA = await jsonGet(app, `/session?directory=${tmpA.path}`)
    const listB = await jsonGet(app, `/session?directory=${tmpB.path}`)

    expect(listA).toHaveLength(1)
    expect(listA[0].id).toBe(sessionA.id)
    expect(listB).toHaveLength(1)
    expect(listB[0].id).toBe(sessionB.id)
  })

  test("deleting a session in one directory doesn't affect another", async () => {
    await using tmpA = await tmpdir({ git: true })
    await using tmpB = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })

    const { data: sessionA } = await jsonPost(app, `/session?directory=${tmpA.path}`)
    await jsonPost(app, `/session?directory=${tmpB.path}`)

    await app.request(`/session/${sessionA.id}?directory=${tmpA.path}`, { method: "DELETE" })

    const listA = await jsonGet(app, `/session?directory=${tmpA.path}`)
    const listB = await jsonGet(app, `/session?directory=${tmpB.path}`)

    expect(listA).toHaveLength(0)
    expect(listB).toHaveLength(1)
  })
})

describe("multiple sessions in same directory", () => {
  test("multiple sessions coexist and are individually accessible", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })

    const { data: s1 } = await jsonPost(app, `/session?directory=${tmp.path}`)
    const { data: s2 } = await jsonPost(app, `/session?directory=${tmp.path}`)
    const { data: s3 } = await jsonPost(app, `/session?directory=${tmp.path}`)

    const list = await jsonGet(app, `/session?directory=${tmp.path}`)
    expect(list).toHaveLength(3)

    const ids = list.map((s: any) => s.id)
    expect(ids).toContain(s1.id)
    expect(ids).toContain(s2.id)
    expect(ids).toContain(s3.id)

    const fetched = await jsonGet(app, `/session/${s2.id}?directory=${tmp.path}`)
    expect(fetched.id).toBe(s2.id)
  })

  test("deleting one session preserves the others", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })

    const { data: s1 } = await jsonPost(app, `/session?directory=${tmp.path}`)
    const { data: s2 } = await jsonPost(app, `/session?directory=${tmp.path}`)
    const { data: s3 } = await jsonPost(app, `/session?directory=${tmp.path}`)

    await app.request(`/session/${s2.id}?directory=${tmp.path}`, { method: "DELETE" })

    const list = await jsonGet(app, `/session?directory=${tmp.path}`)
    expect(list).toHaveLength(2)
    const ids = list.map((s: any) => s.id)
    expect(ids).toContain(s1.id)
    expect(ids).toContain(s3.id)
    expect(ids).not.toContain(s2.id)
  })
})

describe("session CRUD through daemon API", () => {
  test("full create-get-update-delete lifecycle", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })

    const { res: createRes, data: created } = await jsonPost(app, `/session?directory=${tmp.path}`)
    expect(createRes.status).toBe(200)
    expect(created.id).toBeDefined()

    const fetched = await jsonGet(app, `/session/${created.id}?directory=${tmp.path}`)
    expect(fetched.id).toBe(created.id)

    const { data: updated } = await jsonPatch(app, `/session/${created.id}?directory=${tmp.path}`, {
      title: "Updated Title",
    })
    expect(updated.title).toBe("Updated Title")

    const refetched = await jsonGet(app, `/session/${created.id}?directory=${tmp.path}`)
    expect(refetched.title).toBe("Updated Title")

    const deleteRes = await app.request(`/session/${created.id}?directory=${tmp.path}`, { method: "DELETE" })
    expect(deleteRes.status).toBe(200)

    const getRes = await app.request(`/session/${created.id}?directory=${tmp.path}`)
    expect(getRes.status).toBe(404)
  })
})

describe("session daemon metadata fields", () => {
  test("create with all daemon metadata fields round-trips", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })

    const metadata = {
      providerID: "anthropic",
      modelID: "claude-4",
      gitBranch: "feat/test",
      gitWorktree: "/tmp/wt",
      displayName: "My Task",
      prReference: "PR #42",
    }

    const { data: created } = await jsonPost(app, `/session?directory=${tmp.path}`, metadata)
    expect(created.providerID).toBe(metadata.providerID)
    expect(created.modelID).toBe(metadata.modelID)
    expect(created.gitBranch).toBe(metadata.gitBranch)
    expect(created.gitWorktree).toBe(metadata.gitWorktree)
    expect(created.displayName).toBe(metadata.displayName)
    expect(created.prReference).toBe(metadata.prReference)

    const fetched = await jsonGet(app, `/session/${created.id}?directory=${tmp.path}`)
    expect(fetched.providerID).toBe(metadata.providerID)
    expect(fetched.modelID).toBe(metadata.modelID)
    expect(fetched.gitBranch).toBe(metadata.gitBranch)
    expect(fetched.gitWorktree).toBe(metadata.gitWorktree)
    expect(fetched.displayName).toBe(metadata.displayName)
    expect(fetched.prReference).toBe(metadata.prReference)
  })

  test("create without optional fields returns undefined", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })

    const { data: created } = await jsonPost(app, `/session?directory=${tmp.path}`)
    expect(created.providerID).toBeUndefined()
    expect(created.modelID).toBeUndefined()
    expect(created.gitBranch).toBeUndefined()
    expect(created.gitWorktree).toBeUndefined()
    expect(created.prReference).toBeUndefined()
    expect(created.displayName).toBeUndefined()
  })
})

describe("global session listing", () => {
  test("lists sessions from multiple directories with project metadata", async () => {
    await using tmpA = await tmpdir({ git: true })
    await using tmpB = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })

    await jsonPost(app, `/session?directory=${tmpA.path}`)
    await jsonPost(app, `/session?directory=${tmpB.path}`)

    // Global listing scoped to a directory still returns project metadata
    const listA = await jsonGet(app, `/experimental/session?directory=${tmpA.path}`)
    expect(listA).toHaveLength(1)
    expect(listA[0].project).toBeDefined()
    expect(listA[0].project.worktree).toBeDefined()

    const listB = await jsonGet(app, `/experimental/session?directory=${tmpB.path}`)
    expect(listB).toHaveLength(1)
    expect(listB[0].project).toBeDefined()
    expect(listB[0].project.worktree).not.toBe(listA[0].project.worktree)
  })

  test("excludes archived sessions by default", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })

    const { data: s1 } = await jsonPost(app, `/session?directory=${tmp.path}`)
    await jsonPost(app, `/session?directory=${tmp.path}`)

    await jsonPatch(app, `/session/${s1.id}?directory=${tmp.path}`, { time: { archived: Date.now() } })

    const defaultList = await jsonGet(app, `/experimental/session?directory=${tmp.path}`)
    const defaultIds = defaultList.map((s: any) => s.id)
    expect(defaultIds).not.toContain(s1.id)

    const archivedList = await jsonGet(app, `/experimental/session?directory=${tmp.path}&archived=true`)
    const archivedIds = archivedList.map((s: any) => s.id)
    expect(archivedIds).toContain(s1.id)
  })

  test("supports cursor pagination", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })

    await jsonPost(app, `/session?directory=${tmp.path}`)
    await new Promise((r) => setTimeout(r, 5))
    await jsonPost(app, `/session?directory=${tmp.path}`)
    await new Promise((r) => setTimeout(r, 5))
    await jsonPost(app, `/session?directory=${tmp.path}`)

    const firstPage = await app.request(`/experimental/session?directory=${tmp.path}&limit=1`)
    const firstData = await firstPage.json()
    expect(firstData).toHaveLength(1)

    const cursor = firstPage.headers.get("x-next-cursor")
    expect(cursor).toBeDefined()

    const secondPage = await jsonGet(app, `/experimental/session?directory=${tmp.path}&limit=1&cursor=${cursor}`)
    expect(secondPage).toHaveLength(1)
    expect(secondPage[0].id).not.toBe(firstData[0].id)
  })
})

describe("session forking", () => {
  test("fork creates a new session", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })

    const { data: original } = await jsonPost(app, `/session?directory=${tmp.path}`, { title: "Original" })

    const { res: forkRes, data: forked } = await jsonPost(app, `/session/${original.id}/fork?directory=${tmp.path}`, {})
    expect(forkRes.status).toBe(200)
    expect(forked.id).not.toBe(original.id)
    expect(forked.title).toContain("(fork")

    const list = await jsonGet(app, `/session?directory=${tmp.path}`)
    expect(list).toHaveLength(2)
    const ids = list.map((s: any) => s.id)
    expect(ids).toContain(original.id)
    expect(ids).toContain(forked.id)
  })
})

describe("SSE event isolation", () => {
  test("SSE with sessionID filter only receives matching events", async () => {
    const app = GlobalRoutes()
    const seen = await collectSSE(
      app,
      "?sessionID=ses_target",
      () => {
        GlobalBus.emit("event", {
          directory: "test",
          payload: { type: "session.status", properties: { sessionID: "ses_target" } },
        })
        GlobalBus.emit("event", {
          directory: "test",
          payload: { type: "session.status", properties: { sessionID: "ses_other" } },
        })
      },
      { collectCount: 1 },
    )

    expect(seen.length).toBe(1)
    const payload = (seen[0] as SSEEvent).payload
    expect(payload.properties.sessionID).toBe("ses_target")
  })

  test("SSE without filter receives all session events", async () => {
    const app = GlobalRoutes()
    const seen = await collectSSE(
      app,
      "",
      () => {
        GlobalBus.emit("event", {
          directory: "test",
          payload: { type: "session.status", properties: { sessionID: "ses_one" } },
        })
        GlobalBus.emit("event", {
          directory: "test",
          payload: { type: "session.status", properties: { sessionID: "ses_two" } },
        })
      },
      { collectCount: 2 },
    )

    expect(seen.length).toBe(2)
  })
})

describe("concurrent session operations", () => {
  test("concurrent creation across directories has no cross-contamination", async () => {
    await using tmpA = await tmpdir({ git: true })
    await using tmpB = await tmpdir({ git: true })
    await using tmpC = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })

    await Promise.all([
      jsonPost(app, `/session?directory=${tmpA.path}`),
      jsonPost(app, `/session?directory=${tmpB.path}`),
      jsonPost(app, `/session?directory=${tmpC.path}`),
    ])

    const [listA, listB, listC] = await Promise.all([
      jsonGet(app, `/session?directory=${tmpA.path}`),
      jsonGet(app, `/session?directory=${tmpB.path}`),
      jsonGet(app, `/session?directory=${tmpC.path}`),
    ])

    expect(listA).toHaveLength(1)
    expect(listB).toHaveLength(1)
    expect(listC).toHaveLength(1)
  })
})

describe("worktree session metadata", () => {
  test("gitWorktree and gitBranch persist through API", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = Server.createApp({ daemon: true })

    const { data: created } = await jsonPost(app, `/session?directory=${tmp.path}`, {
      gitWorktree: "/tmp/my-worktree",
      gitBranch: "feat/wt-branch",
    })
    expect(created.gitWorktree).toBe("/tmp/my-worktree")
    expect(created.gitBranch).toBe("feat/wt-branch")

    const fetched = await jsonGet(app, `/session/${created.id}?directory=${tmp.path}`)
    expect(fetched.gitWorktree).toBe("/tmp/my-worktree")
    expect(fetched.gitBranch).toBe("feat/wt-branch")
  })
})

describe("config daemon.worktree field", () => {
  test("config returns daemon.worktree when set", async () => {
    await using tmp = await tmpdir({ git: true, config: { daemon: { worktree: true } } })
    const app = Server.createApp({ daemon: true })

    const config = await jsonGet(app, `/config?directory=${tmp.path}`)
    expect(config.daemon?.worktree).toBe(true)
  })
})
