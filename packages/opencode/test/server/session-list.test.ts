import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Log } from "../../src/util/log"
import { Database, eq } from "../../src/storage/db"
import { SessionTable } from "../../src/session/session.sql"
import { tmpdir } from "../fixture/fixture"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("Session.list", () => {
  test("filters by directory", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const first = await Session.create({})

        const otherDir = path.join(projectRoot, "..", "__session_list_other")
        const second = await Instance.provide({
          directory: otherDir,
          fn: async () => Session.create({}),
        })

        const sessions = [...Session.list({ directory: projectRoot })]
        const ids = sessions.map((s) => s.id)

        expect(ids).toContain(first.id)
        expect(ids).not.toContain(second.id)
      },
    })
  })

  test("lists worktree directory sessions without relying on project id", async () => {
    await using tmp = await tmpdir({ git: true })
    await using other = await tmpdir({ git: true })
    const wt = path.join(tmp.path, "..", path.basename(tmp.path) + "-wt-list")

    try {
      await $`git worktree add ${wt} -b list-${Date.now()}`.cwd(tmp.path).quiet()

      const main = await Instance.provide({
        directory: tmp.path,
        fn: async () => Session.create({ title: "main" }),
      })
      const item = await Instance.provide({
        directory: wt,
        fn: async () => Session.create({ title: "worktree" }),
      })
      const alt = await Instance.provide({
        directory: other.path,
        fn: async () => Session.create({ title: "other" }),
      })

      Database.use((db) =>
        db.update(SessionTable).set({ project_id: alt.projectID }).where(eq(SessionTable.id, item.id)).run(),
      )

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const sessions = [...Session.list({ directory: wt, roots: true })]
          const ids = sessions.map((s) => s.id)

          expect(ids).toContain(item.id)
          expect(ids).not.toContain(main.id)
          expect(ids).not.toContain(alt.id)
        },
      })
    } finally {
      await $`git worktree remove ${wt}`
        .cwd(tmp.path)
        .quiet()
        .catch(() => {})
    }
  })

  test("filters root sessions", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const root = await Session.create({ title: "root-session" })
        const child = await Session.create({ title: "child-session", parentID: root.id })

        const sessions = [...Session.list({ roots: true })]
        const ids = sessions.map((s) => s.id)

        expect(ids).toContain(root.id)
        expect(ids).not.toContain(child.id)
      },
    })
  })

  test("filters by start time", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({ title: "new-session" })
        const futureStart = Date.now() + 86400000

        const sessions = [...Session.list({ start: futureStart })]
        expect(sessions.length).toBe(0)
      },
    })
  })

  test("filters by search term", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        await Session.create({ title: "unique-search-term-abc" })
        await Session.create({ title: "other-session-xyz" })

        const sessions = [...Session.list({ search: "unique-search" })]
        const titles = sessions.map((s) => s.title)

        expect(titles).toContain("unique-search-term-abc")
        expect(titles).not.toContain("other-session-xyz")
      },
    })
  })

  test("respects limit parameter", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        await Session.create({ title: "session-1" })
        await Session.create({ title: "session-2" })
        await Session.create({ title: "session-3" })

        const sessions = [...Session.list({ limit: 2 })]
        expect(sessions.length).toBe(2)
      },
    })
  })
})
