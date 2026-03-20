import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Log } from "../../src/util/log"

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

  test("filters by directory with backslash variation", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({ title: "backslash-test" })

        // Query with backslashes should match forward slashes
        const backSlash = projectRoot.replace(/\//g, "\\")
        const sessions = [...Session.list({ directory: backSlash })]
        const ids = sessions.map((s) => s.id)

        expect(ids).toContain(session.id)
      },
    })
  })

  test("filters by directory with case variation (Windows)", async () => {
    if (process.platform !== "win32") {
      return
    }

    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({ title: "case-variation-test" })

        // Query with lowercase drive letter should match
        const lowerCase = projectRoot.replace(/^([A-Z]):/, (_, d) => d.toLowerCase() + ":")
        const sessions = [...Session.list({ directory: lowerCase })]
        const ids = sessions.map((s) => s.id)

        expect(ids).toContain(session.id)
      },
    })
  })

  test("filters by directory with mixed variations", async () => {
    if (process.platform !== "win32") {
      return
    }

    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({ title: "mixed-variation-test" })

        // Query with mixed backslashes and lowercase drive letter
        const mixed = projectRoot.replace(/\//g, "\\").replace(/^([A-Z]):/, (_, d) => d.toLowerCase() + ":")
        const sessions = [...Session.list({ directory: mixed })]
        const ids = sessions.map((s) => s.id)

        expect(ids).toContain(session.id)
      },
    })
  })
})
