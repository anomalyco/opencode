import { describe, expect, spyOn, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { Log } from "../../src/util/log"
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

  test("manual summarize bumps updated time and reorders list", async () => {
    await using tmp = await tmpdir({ git: true })
    const loop = spyOn(SessionPrompt, "loop").mockImplementation(
      (async () => undefined as never) as unknown as typeof SessionPrompt.loop,
    )

    try {
      const one = await Instance.provide({
        directory: tmp.path,
        fn: async () => Session.create({ title: "one" }),
      })
      await new Promise((resolve) => setTimeout(resolve, 5))
      const two = await Instance.provide({
        directory: tmp.path,
        fn: async () => Session.create({ title: "two" }),
      })

      const before = await Instance.provide({
        directory: tmp.path,
        fn: async () => Session.get(one.id),
      })
      const initial = await Instance.provide({
        directory: tmp.path,
        fn: async () => [...Session.list({ directory: tmp.path, limit: 2 })],
      })
      expect(initial[0].id).toBe(two.id)

      await new Promise((resolve) => setTimeout(resolve, 5))

      const app = Server.App()
      const response = await app.request(`/session/${one.id}/summarize`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-opencode-directory": tmp.path,
        },
        body: JSON.stringify({
          providerID: "test",
          modelID: "test",
          auto: false,
        }),
      })

      expect(response.status).toBe(200)
      expect(await response.json()).toBe(true)

      const after = await Instance.provide({
        directory: tmp.path,
        fn: async () => Session.get(one.id),
      })
      const sessions = await Instance.provide({
        directory: tmp.path,
        fn: async () => [...Session.list({ directory: tmp.path, limit: 2 })],
      })
      expect(after.time.updated).toBeGreaterThan(before.time.updated)
      expect(sessions[0].id).toBe(one.id)
    } finally {
      loop.mockRestore()
    }
  })
})
