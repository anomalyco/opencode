import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Project } from "../../src/project/project"
import { Session } from "../../src/session"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

async function list(input?: Parameters<typeof Session.list>[0]) {
  return Array.fromAsync(Session.list(input))
}

async function create(dir: string, name: string) {
  return (await Project.createForDirectory({ workspace: dir, name, tenantUserId: "user_test" })).project
}

describe("Session.list", () => {
  test("lists sessions for current project only", async () => {
    // Note: Sessions no longer have a local directory (directory is null)
    // Session.list() automatically filters by the current project context
    await using first = await tmpdir({ git: true })
    const firstProject = await create(first.path, "session-list-main")
    await Instance.provide({
      project: firstProject,
      fn: async () => {
        const first = await Session.create({ title: "first-project-session" })

        // Create a session in a different project context
        await using secondDir = await tmpdir({ git: true })
        const secondProject = await create(secondDir.path, "session-list-other")
        const second = await Instance.provide({
          project: secondProject,
          fn: async () => Session.create({ title: "second-project-session" }),
        })

        // When listing in first project context, only see first project's sessions
        const sessions = await list()
        const ids = sessions.map((s) => s.id)

        expect(ids).toContain(first.id)
        expect(ids).not.toContain(second.id)
      },
    })
  })

  test("filters root sessions", async () => {
    await using tmp = await tmpdir({ git: true })
    const project = await create(tmp.path, "session-roots")
    await Instance.provide({
      workspace: tmp.path,
      project,
      fn: async () => {
        const root = await Session.create({ title: "root-session" })
        const child = await Session.create({ title: "child-session", parentID: root.id })

        const sessions = await list({ roots: true })
        const ids = sessions.map((s) => s.id)

        expect(ids).toContain(root.id)
        expect(ids).not.toContain(child.id)
      },
    })
  })

  test("filters by start time", async () => {
    await using tmp = await tmpdir({ git: true })
    const project = await create(tmp.path, "session-start")
    await Instance.provide({
      workspace: tmp.path,
      project,
      fn: async () => {
        await Session.create({ title: "new-session" })
        const futureStart = Date.now() + 86400000

        const sessions = await list({ start: futureStart })
        expect(sessions.length).toBe(0)
      },
    })
  })

  test("filters by search term", async () => {
    await using tmp = await tmpdir({ git: true })
    const project = await create(tmp.path, "session-search")
    await Instance.provide({
      workspace: tmp.path,
      project,
      fn: async () => {
        await Session.create({ title: "unique-search-term-abc" })
        await Session.create({ title: "other-session-xyz" })

        const sessions = await list({ search: "unique-search" })
        const titles = sessions.map((s) => s.title)

        expect(titles).toContain("unique-search-term-abc")
        expect(titles).not.toContain("other-session-xyz")
      },
    })
  })

  test("respects limit parameter", async () => {
    await using tmp = await tmpdir({ git: true })
    const project = await create(tmp.path, "session-limit")
    await Instance.provide({
      workspace: tmp.path,
      project,
      fn: async () => {
        await Session.create({ title: "session-1" })
        await Session.create({ title: "session-2" })
        await Session.create({ title: "session-3" })

        const sessions = await list({ limit: 2 })
        expect(sessions.length).toBe(2)
      },
    })
  })
})
