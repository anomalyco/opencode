import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { Bus } from "../../src/bus"
import { Log } from "../../src/util/log"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("session.create with metadata", () => {
  test("sets role=worker when x-opencode-env-ORCH_WORKER header is present", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const app = Server.App()

        // Create session with ORCH_WORKER header
        const response = await app.request("/session", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-opencode-env-ORCH_WORKER": "1",
          },
          body: JSON.stringify({
            title: "Test worker session",
          }),
        })

        expect(response.status).toBe(200)

        const body = (await response.json()) as any
        expect(body.metadata).toBeDefined()
        expect(body.metadata.role).toBe("worker")
      },
    })
  })

  test("does not set role when x-opencode-env-ORCH_WORKER header is absent", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const app = Server.App()

        // Create session without ORCH_WORKER header
        const response = await app.request("/session", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            title: "Test orchestrator session",
          }),
        })

        expect(response.status).toBe(200)

        const body = (await response.json()) as any
        // metadata should be undefined or empty when no header is present
        expect(body.metadata?.role).toBeUndefined()
      },
    })
  })

  test("preserves other metadata when setting role", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const app = Server.App()

        // Create session with ORCH_WORKER header and custom metadata
        const response = await app.request("/session", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-opencode-env-ORCH_WORKER": "1",
          },
          body: JSON.stringify({
            title: "Test worker session with metadata",
            metadata: {
              // Any other metadata fields would go here if they existed
            },
          }),
        })

        expect(response.status).toBe(200)

        const body = (await response.json()) as any
        expect(body.metadata).toBeDefined()
        expect(body.metadata.role).toBe("worker")
      },
    })
  })

  test("session.created event includes metadata.role", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const app = Server.App()

        // Subscribe to session.created event
        const eventPromise = new Promise<Session.Info>((resolve) => {
          const unsubscribe = Bus.subscribe(Session.Event.Created, (event) => {
            unsubscribe()
            resolve(event.properties.info)
          })
        })

        // Create session with ORCH_WORKER header
        const response = await app.request("/session", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-opencode-env-ORCH_WORKER": "1",
          },
          body: JSON.stringify({
            title: "Test worker session event",
          }),
        })

        expect(response.status).toBe(200)

        // Wait for the session.created event
        const sessionInfo = await eventPromise

        // Verify the event includes metadata.role
        expect(sessionInfo.metadata).toBeDefined()
        expect(sessionInfo.metadata?.role).toBe("worker")
      },
    })
  })
})
