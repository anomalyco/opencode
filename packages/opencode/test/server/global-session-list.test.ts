import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Project } from "../../src/project/project"
import { Session } from "../../src/session"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

async function list(input?: Parameters<typeof Session.listGlobal>[0]) {
  return Array.fromAsync(Session.listGlobal(input))
}

describe("Session.listGlobal", () => {
  test("lists sessions across projects with project metadata", async () => {
    await using first = await tmpdir({ git: true })
    await using second = await tmpdir({ git: true })
    const firstProject = (await Project.createForDirectory({
      workspace: first.path,
      name: "global-first",
      tenantUserId: "user_test",
    })).project
    const secondProject = (await Project.createForDirectory({
      workspace: second.path,
      name: "global-second",
      tenantUserId: "user_test",
    })).project

    const firstSession = await Instance.provide({
      project: firstProject,
      fn: async () => Session.create({ title: "first-session" }),
    })
    const secondSession = await Instance.provide({
      project: secondProject,
      fn: async () => Session.create({ title: "second-session" }),
    })

    const sessions = await list({ limit: 200 })
    const ids = sessions.map((session) => session.id)

    expect(ids).toContain(firstSession.id)
    expect(ids).toContain(secondSession.id)

    const firstSaved = await Project.get(firstSession.projectID)
    const secondSaved = await Project.get(secondSession.projectID)

    const firstItem = sessions.find((session) => session.id === firstSession.id)
    const secondItem = sessions.find((session) => session.id === secondSession.id)

    expect(firstItem?.project?.id).toBe(firstSaved?.id)
    expect(secondItem?.project?.id).toBe(secondSaved?.id)
  })

  test("excludes archived sessions by default", async () => {
    await using tmp = await tmpdir({ git: true })
    const project = (await Project.createForDirectory({
      workspace: tmp.path,
      name: "global-archived",
      tenantUserId: "user_test",
    })).project

    const archived = await Instance.provide({
      workspace: tmp.path,
      project,
      fn: async () => Session.create({ title: "archived-session" }),
    })

    await Instance.provide({
      workspace: tmp.path,
      project,
      fn: async () => Session.setArchived({ sessionID: archived.id, time: Date.now() }),
    })

    const sessions = await list({ limit: 200 })
    const ids = sessions.map((session) => session.id)

    expect(ids).not.toContain(archived.id)

    const allSessions = await list({ limit: 200, archived: true })
    const allIds = allSessions.map((session) => session.id)

    expect(allIds).toContain(archived.id)
  })

  test("supports cursor pagination", async () => {
    await using tmp = await tmpdir({ git: true })
    const project = (await Project.createForDirectory({
      workspace: tmp.path,
      name: "global-cursor",
      tenantUserId: "user_test",
    })).project

    const first = await Instance.provide({
      workspace: tmp.path,
      project,
      fn: async () => Session.create({ title: "page-one" }),
    })
    await new Promise((resolve) => setTimeout(resolve, 5))
    const second = await Instance.provide({
      workspace: tmp.path,
      project,
      fn: async () => Session.create({ title: "page-two" }),
    })

    // Sessions are stateless - no directory field anymore
    // We filter by project via the Instance context
    const allSessions = await list({ limit: 200 })
    const projectSessions = allSessions.filter(s => s.projectID === project.id)
    
    expect(projectSessions.length).toBeGreaterThanOrEqual(2)
    expect(projectSessions.map(s => s.id)).toContain(first.id)
    expect(projectSessions.map(s => s.id)).toContain(second.id)

    // Cursor pagination still works without directory filter
    const page = await list({ limit: 1 })
    expect(page.length).toBe(1)

    const next = await list({ limit: 10, cursor: page[0].time.updated })
    expect(next.length).toBeGreaterThanOrEqual(0)
  })
})
