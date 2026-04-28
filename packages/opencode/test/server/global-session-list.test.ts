import { afterEach, describe, expect, test } from "bun:test"
import type { UpgradeWebSocket } from "hono/ws"
import { Effect } from "effect"
import z from "zod"
import { Instance } from "../../src/project/instance"
import { InstanceRoutes } from "../../src/server/routes/instance"
import { Project } from "@/project/project"
import { Session as SessionNs } from "@/session/session"
import { WorkspaceContext } from "../../src/control-plane/workspace-context"
import { WorkspaceID } from "../../src/control-plane/schema"
import * as Log from "@opencode-ai/core/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

void Log.init({ print: false })
const websocket = (() => () => new Response(null, { status: 501 })) as unknown as UpgradeWebSocket

function run<A, E>(fx: Effect.Effect<A, E, SessionNs.Service>) {
  return Effect.runPromise(fx.pipe(Effect.provide(SessionNs.defaultLayer)))
}

const svc = {
  ...SessionNs,
  create(input?: SessionNs.CreateInput) {
    return run(SessionNs.Service.use((svc) => svc.create(input)))
  },
  get(sessionID: SessionNs.Info["id"]) {
    return run(SessionNs.Service.use((svc) => svc.get(sessionID)))
  },
  children(sessionID: SessionNs.Info["id"]) {
    return run(SessionNs.Service.use((svc) => svc.children(sessionID)))
  },
  setArchived(input: z.output<typeof SessionNs.SetArchivedInput.zod>) {
    return run(SessionNs.Service.use((svc) => svc.setArchived(input)))
  },
  migrate(input: SessionNs.MigrateInput) {
    return run(SessionNs.Service.use((svc) => svc.migrate(input)))
  },
}

afterEach(async () => {
  await Instance.disposeAll()
  await resetDatabase()
})

describe("session.listGlobal", () => {
  test("lists sessions across projects with project metadata", async () => {
    await using first = await tmpdir({ git: true })
    await using second = await tmpdir({ git: true })

    const firstSession = await Instance.provide({
      directory: first.path,
      fn: async () => svc.create({ title: "first-session" }),
    })
    const secondSession = await Instance.provide({
      directory: second.path,
      fn: async () => svc.create({ title: "second-session" }),
    })

    const sessions = [...svc.listGlobal({ limit: 200 })]
    const ids = sessions.map((session) => session.id)

    expect(ids).toContain(firstSession.id)
    expect(ids).toContain(secondSession.id)

    const firstProject = Project.get(firstSession.projectID)
    const secondProject = Project.get(secondSession.projectID)

    const firstItem = sessions.find((session) => session.id === firstSession.id)
    const secondItem = sessions.find((session) => session.id === secondSession.id)

    expect(firstItem?.project?.id).toBe(firstProject?.id)
    expect(firstItem?.project?.worktree).toBe(firstProject?.worktree)
    expect(secondItem?.project?.id).toBe(secondProject?.id)
    expect(secondItem?.project?.worktree).toBe(secondProject?.worktree)
  })

  test("excludes archived sessions by default", async () => {
    await using tmp = await tmpdir({ git: true })

    const archived = await Instance.provide({
      directory: tmp.path,
      fn: async () => svc.create({ title: "archived-session" }),
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => svc.setArchived({ sessionID: archived.id, time: Date.now() }),
    })

    const sessions = [...svc.listGlobal({ limit: 200 })]
    const ids = sessions.map((session) => session.id)

    expect(ids).not.toContain(archived.id)

    const allSessions = [...svc.listGlobal({ limit: 200, archived: true })]
    const allIds = allSessions.map((session) => session.id)

    expect(allIds).toContain(archived.id)
  })

  test("supports cursor pagination", async () => {
    await using tmp = await tmpdir({ git: true })

    const first = await Instance.provide({
      directory: tmp.path,
      fn: async () => svc.create({ title: "page-one" }),
    })
    await new Promise((resolve) => setTimeout(resolve, 5))
    const second = await Instance.provide({
      directory: tmp.path,
      fn: async () => svc.create({ title: "page-two" }),
    })

    const page = [...svc.listGlobal({ directory: tmp.path, limit: 1 })]
    expect(page.length).toBe(1)
    expect(page[0].id).toBe(second.id)

    const next = [...svc.listGlobal({ directory: tmp.path, limit: 10, cursor: page[0].time.updated })]
    const ids = next.map((session) => session.id)

    expect(ids).toContain(first.id)
    expect(ids).not.toContain(second.id)
  })

  test("filters by workspace", async () => {
    await using tmp = await tmpdir({ git: true })
    const one = WorkspaceID.ascending()
    const two = WorkspaceID.ascending()

    const first = await WorkspaceContext.provide({
      workspaceID: one,
      fn: () =>
        Instance.provide({
          directory: tmp.path,
          fn: async () => svc.create({ title: "workspace-one-session" }),
        }),
    })
    const second = await WorkspaceContext.provide({
      workspaceID: two,
      fn: () =>
        Instance.provide({
          directory: tmp.path,
          fn: async () => svc.create({ title: "workspace-two-session" }),
        }),
    })

    const sessions = [...svc.listGlobal({ workspaceID: one, limit: 200 })]
    const ids = sessions.map((session) => session.id)

    expect(ids).toContain(first.id)
    expect(ids).not.toContain(second.id)
  })

  test("migrates a root session and its children to another project", async () => {
    await using source = await tmpdir({ git: true })
    await using target = await tmpdir({ git: true })

    const parent = await Instance.provide({
      directory: source.path,
      fn: async () => svc.create({ title: "migrate-parent" }),
    })
    const child = await Instance.provide({
      directory: source.path,
      fn: async () => svc.create({ title: "migrate-child", parentID: parent.id }),
    })
    const targetProject = await Instance.provide({
      directory: target.path,
      fn: async () => Instance.project,
    })

    await Instance.provide({
      directory: target.path,
      fn: async () =>
        svc.migrate({
          sessionID: parent.id,
          projectID: targetProject.id,
          directory: target.path,
        }),
    })

    const migratedParent = await svc.get(parent.id)
    const migratedChild = await svc.get(child.id)

    expect(migratedParent.projectID).toBe(targetProject.id)
    expect(migratedParent.directory).toBe(target.path)
    expect(migratedChild.projectID).toBe(targetProject.id)
    expect(migratedChild.directory).toBe(target.path)
  })

  test("lists sessions whose directory no longer exists as orphans", async () => {
    const source = await tmpdir({ git: true })
    await using current = await tmpdir({ git: true })

    const session = await Instance.provide({
      directory: source.path,
      fn: async () => svc.create({ title: "missing-directory" }),
    })

    await source[Symbol.asyncDispose]()

    const orphans = await Instance.provide({
      directory: current.path,
      fn: async () => [...svc.listOrphans()],
    })

    expect(orphans.map((item) => item.id)).toContain(session.id)
  })

  test("session history endpoint lists sessions across projects", async () => {
    await using first = await tmpdir({ git: true })
    await using second = await tmpdir({ git: true })

    const one = await Instance.provide({
      directory: first.path,
      fn: async () => svc.create({ title: "history-first" }),
    })
    const two = await Instance.provide({
      directory: second.path,
      fn: async () => svc.create({ title: "history-second" }),
    })

    const response = await Instance.provide({
      directory: first.path,
      fn: async () => InstanceRoutes(websocket).request("/session/history?roots=true&limit=200"),
    })
    expect(response.status).toBe(200)

    const sessions = (await response.json()) as SessionNs.GlobalInfo[]
    const ids = sessions.map((session) => session.id)

    expect(ids).toContain(one.id)
    expect(ids).toContain(two.id)
    expect(sessions.find((session) => session.id === one.id)?.project?.id).toBe(one.projectID)
    expect(sessions.find((session) => session.id === two.id)?.project?.id).toBe(two.projectID)
  })

  test("session orphans and migrate endpoints", async () => {
    const source = await tmpdir({ git: true })
    await using target = await tmpdir({ git: true })
    await using current = await tmpdir({ git: true })

    const session = await Instance.provide({
      directory: source.path,
      fn: async () => svc.create({ title: "endpoint-orphan" }),
    })
    const targetProject = await Instance.provide({
      directory: target.path,
      fn: async () => Instance.project,
    })

    await source[Symbol.asyncDispose]()

    const orphanResponse = await Instance.provide({
      directory: current.path,
      fn: async () => InstanceRoutes(websocket).request("/session/orphans"),
    })
    expect(orphanResponse.status).toBe(200)

    const orphans = (await orphanResponse.json()) as SessionNs.GlobalInfo[]
    expect(orphans.map((item) => item.id)).toContain(session.id)

    const migrateResponse = await Instance.provide({
      directory: target.path,
      fn: async () =>
        InstanceRoutes(websocket).request(`/session/${session.id}/migrate`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            projectID: targetProject.id,
            directory: target.path,
          }),
        }),
    })
    expect(migrateResponse.status).toBe(200)

    const migrated = (await migrateResponse.json()) as SessionNs.Info
    expect(migrated.projectID).toBe(targetProject.id)
    expect(migrated.directory).toBe(target.path)
  })

  test("session history endpoint supports cursor pagination", async () => {
    await using tmp = await tmpdir({ git: true })

    const first = await Instance.provide({
      directory: tmp.path,
      fn: async () => svc.create({ title: "history-page-one" }),
    })
    await new Promise((resolve) => setTimeout(resolve, 5))
    const second = await Instance.provide({
      directory: tmp.path,
      fn: async () => svc.create({ title: "history-page-two" }),
    })

    const page = await Instance.provide({
      directory: tmp.path,
      fn: async () =>
        InstanceRoutes(websocket).request(`/session/history?directory=${encodeURIComponent(tmp.path)}&limit=1`),
    })
    expect(page.status).toBe(200)
    expect(page.headers.get("x-next-cursor")).toBeTruthy()

    const sessions = (await page.json()) as SessionNs.GlobalInfo[]
    expect(sessions.map((session) => session.id)).toEqual([second.id])

    const next = await Instance.provide({
      directory: tmp.path,
      fn: async () =>
        InstanceRoutes(websocket).request(
          `/session/history?directory=${encodeURIComponent(tmp.path)}&limit=10&cursor=${sessions[0].time.updated}`,
        ),
    })
    expect(next.status).toBe(200)

    const rest = (await next.json()) as SessionNs.GlobalInfo[]
    const ids = rest.map((session) => session.id)

    expect(ids).toContain(first.id)
    expect(ids).not.toContain(second.id)
  })
})
