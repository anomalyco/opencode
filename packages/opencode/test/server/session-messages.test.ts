import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { Identifier } from "../../src/id/id"
import { Log } from "../../src/util/log"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

const password = process.env.OPENCODE_SERVER_PASSWORD
const username = process.env.OPENCODE_SERVER_USERNAME ?? "opencode"
const auth = password ? "Basic " + Buffer.from(`${username}:${password}`).toString("base64") : undefined

const request = (app: ReturnType<typeof Server.App>, url: string) => {
  if (!auth) return app.request(url)
  return app.request(url, { headers: { Authorization: auth } })
}

const TEST_TIMEOUT_MS = 30_000

describe("session.messages API", () => {
  test(
    "returns 400 when both before and after specified",
    async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const app = Server.App()
          const session = await Session.create({})

          const response = await request(app, `/session/${session.id}/message?before=msg_01ABC&after=msg_01XYZ`)

          expect(response.status).toBe(400)
          const body = (await response.json()) as { error: string }
          expect(body.error).toContain("Cannot specify both")
        },
      })
    },
    TEST_TIMEOUT_MS,
  )

  test("includes Link header with rel=prev when more pages exist (before cursor)", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const app = Server.App()
        const session = await Session.create({})

        // Create 5 messages
        for (let i = 0; i < 5; i++) {
          await Session.updateMessage({
            id: Identifier.ascending("message"),
            role: "user",
            sessionID: session.id,
            agent: "default",
            model: { providerID: "test", modelID: "test" },
            time: { created: Date.now() },
          })
        }

        // Request with limit=2 (should have more)
        const response = await request(app, `/session/${session.id}/message?limit=2`)

        expect(response.status).toBe(200)
        const link = response.headers.get("Link")
        expect(link).toContain('rel="prev"')
        expect(link).toContain("before=")
      },
    })
  })

  test("includes Link header with rel=next when using after cursor with more pages", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const app = Server.App()
        const session = await Session.create({})

        // Create 5 messages
        const ids: string[] = []
        for (let i = 0; i < 5; i++) {
          const msg = await Session.updateMessage({
            id: Identifier.ascending("message"),
            role: "user",
            sessionID: session.id,
            agent: "default",
            model: { providerID: "test", modelID: "test" },
            time: { created: Date.now() },
          })
          ids.push(msg.id)
        }

        // Request after first message with limit=2
        const response = await request(app, `/session/${session.id}/message?after=${ids[0]}&limit=2`)

        expect(response.status).toBe(200)
        const link = response.headers.get("Link")
        expect(link).toContain('rel="next"')
        expect(link).toContain("after=")
      },
    })
  })

  test("omits Link header when no more pages", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const app = Server.App()
        const session = await Session.create({})

        // Create 2 messages
        for (let i = 0; i < 2; i++) {
          await Session.updateMessage({
            id: Identifier.ascending("message"),
            role: "user",
            sessionID: session.id,
            agent: "default",
            model: { providerID: "test", modelID: "test" },
            time: { created: Date.now() },
          })
        }

        // Request with limit=10 (more than available)
        const response = await request(app, `/session/${session.id}/message?limit=10`)

        expect(response.status).toBe(200)
        const link = response.headers.get("Link")
        expect(link).toBeNull()
      },
    })
  })

  test("returns 400 when oldest used with before or after", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const app = Server.App()
        const session = await Session.create({})

        const response1 = await request(app, `/session/${session.id}/message?oldest=true&before=msg_01ABC`)
        expect(response1.status).toBe(400)
        const body1 = (await response1.json()) as { error: string }
        expect(body1.error).toContain("Cannot use 'oldest' with")

        const response2 = await request(app, `/session/${session.id}/message?oldest=true&after=msg_01XYZ`)
        expect(response2.status).toBe(400)
        const body2 = (await response2.json()) as { error: string }
        expect(body2.error).toContain("Cannot use 'oldest' with")
      },
    })
  })

  test("oldest=true returns messages in ascending order with rel=next Link", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const app = Server.App()
        const session = await Session.create({})

        // Create 5 messages
        const ids: string[] = []
        for (let i = 0; i < 5; i++) {
          const msg = await Session.updateMessage({
            id: Identifier.ascending("message"),
            role: "user",
            sessionID: session.id,
            agent: "default",
            model: { providerID: "test", modelID: "test" },
            time: { created: Date.now() },
          })
          ids.push(msg.id)
        }

        // Request oldest with limit=2 (should have more pages)
        const response = await request(app, `/session/${session.id}/message?oldest=true&limit=2`)

        expect(response.status).toBe(200)
        const messages = (await response.json()) as Array<{ info: { id: string } }>
        expect(messages.length).toBe(2)
        // Oldest messages should be first (ascending order)
        expect(messages[0].info.id).toBe(ids[0])
        expect(messages[1].info.id).toBe(ids[1])

        const link = response.headers.get("Link")
        expect(link).toContain('rel="next"')
        expect(link).toContain("after=")
        expect(link).not.toContain("oldest=") // oldest param stripped on subsequent pages
      },
    })
  })

  test("limit=0 returns empty results", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const app = Server.App()
        const session = await Session.create({})

        for (let i = 0; i < 3; i++) {
          await Session.updateMessage({
            id: Identifier.ascending("message"),
            role: "user",
            sessionID: session.id,
            agent: "default",
            model: { providerID: "test", modelID: "test" },
            time: { created: Date.now() },
          })
        }

        const response = await request(app, `/session/${session.id}/message?limit=0`)
        expect(response.status).toBe(200)
        const body = await response.json()
        expect(body).toEqual([])
        expect(response.headers.get("Link")).toBeNull()
      },
    })
  })
})
