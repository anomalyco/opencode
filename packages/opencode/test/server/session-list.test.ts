import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { Log } from "../../src/util/log"
import { Config } from "../../src/config/config"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("session.list", () => {
  test("filters by directory", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const app = Server.App()

        const first = await Session.create({})

        const otherDir = path.join(projectRoot, "..", "__session_list_other")
        const second = await Instance.provide({
          directory: otherDir,
          fn: async () => Session.create({}),
        })

        const response = await app.request(`/session?directory=${encodeURIComponent(projectRoot)}`)
        expect(response.status).toBe(200)

        const body = (await response.json()) as unknown[]
        const ids = body
          .map((s) => (typeof s === "object" && s && "id" in s ? (s as { id: string }).id : undefined))
          .filter((x): x is string => typeof x === "string")

        expect(ids).toContain(first.id)
        expect(ids).not.toContain(second.id)
      },
    })
  })

  test("crossPlatformSessions bypasses directory filter", async () => {
    // Store original config getter
    const originalGet = Config.get

    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const app = Server.App()

        const first = await Session.create({})

        const otherDir = path.join(projectRoot, "..", "__session_list_show_all")
        const second = await Instance.provide({
          directory: otherDir,
          fn: async () => Session.create({}),
        })

        // Mock Config.get to return crossPlatformSessions: true
        Config.get = async () => ({ crossPlatformSessions: true }) as any

        const response = await app.request(`/session?directory=${encodeURIComponent(projectRoot)}`)
        expect(response.status).toBe(200)

        const body = (await response.json()) as unknown[]
        const ids = body
          .map((s) => (typeof s === "object" && s && "id" in s ? (s as { id: string }).id : undefined))
          .filter((x): x is string => typeof x === "string")

        // With showAllSessions: true, both sessions should be visible
        expect(ids).toContain(first.id)
        expect(ids).toContain(second.id)

        // Restore original
        Config.get = originalGet
      },
    })
  })
})
