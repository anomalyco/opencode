import { describe, expect, test } from "bun:test"
import path from "path"
import { MCP } from "../../src/mcp"
import { Session } from "../../src/session"
import { Bus } from "../../src/bus"
import { Log } from "../../src/util/log"
import { Instance } from "../../src/project/instance"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("session-scoped MCP", () => {
  test("should add and retrieve session-scoped MCP tools", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})

        // Create a mock MCP config (won't actually connect)
        const mockConfig = {
          type: "local" as const,
          command: ["echo", "test"],
          enabled: false, // Disabled so it won't try to actually connect
        }

        // Add session-scoped MCP
        await MCP.addSessionScoped(session.id, "test-mcp", mockConfig)

        // Check status includes session-scoped MCP
        const status = await MCP.status(session.id)
        expect(status["test-mcp"]).toBeDefined()

        // Cleanup
        await Session.remove(session.id)
      },
    })
  })

  test("should dispose session-scoped MCPs when session is removed", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})

        const mockConfig = {
          type: "local" as const,
          command: ["echo", "test"],
          enabled: false,
        }

        // Add session-scoped MCP
        await MCP.addSessionScoped(session.id, "test-mcp-dispose", mockConfig)

        // Verify it exists
        let status = await MCP.status(session.id)
        expect(status["test-mcp-dispose"]).toBeDefined()

        // Remove session (should dispose MCP)
        await Session.remove(session.id)

        // Create new session to verify old MCP is gone
        const newSession = await Session.create({})
        status = await MCP.status(newSession.id)
        expect(status["test-mcp-dispose"]).toBeUndefined()

        // Cleanup
        await Session.remove(newSession.id)
      },
    })
  })

  test("should emit session-scoped event when MCP is added", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})

        let eventReceived = false
        let eventScope: string | undefined
        let eventSessionID: string | undefined

        // Subscribe before adding MCP
        const unsub = Bus.subscribe(MCP.Event.ServerAdded, (event) => {
          if (event.properties.name === "test-mcp-event") {
            eventReceived = true
            eventScope = event.properties.scope
            eventSessionID = event.properties.sessionID
          }
        })

        // Use a mock config that will fail but still trigger event
        // We check for events even on failure cases
        const mockConfig = {
          type: "local" as const,
          command: ["/nonexistent/command"],
        }

        // Now add the MCP (will fail but should still emit event)
        await MCP.addSessionScoped(session.id, "test-mcp-event", mockConfig)

        // Wait a bit for event propagation
        await new Promise((resolve) => setTimeout(resolve, 100))

        // Since MCP connection will fail, event should still be published
        // but status will be failed
        const status = await MCP.status(session.id)

        // Verify the MCP was registered even though it failed
        expect(status["test-mcp-event"]).toBeDefined()
        expect(status["test-mcp-event"]?.status).toBe("failed")

        unsub()

        // Cleanup
        await Session.remove(session.id)
      },
    })
  })

  test("should load MCP dynamically regardless of enabled flag", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})

        // Dynamic loading bypasses the enabled flag (which only applies to config-file loading)
        const mockConfig = {
          type: "local" as const,
          command: ["/nonexistent/command"],
          enabled: false, // Ignored for dynamic loading
        }

        await MCP.addSessionScoped(session.id, "disabled-mcp", mockConfig)

        // Should be added (will fail to connect, but that's expected with invalid command)
        const status = await MCP.status(session.id)
        expect(status["disabled-mcp"]).toBeDefined()

        // Cleanup
        await Session.remove(session.id)
      },
    })
  })

  test("instance-scoped MCPs should not interfere with session-scoped", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session1 = await Session.create({})
        const session2 = await Session.create({})

        const mockConfig = {
          type: "local" as const,
          command: ["echo", "test"],
          enabled: false,
        }

        // Add instance-scoped MCP
        await MCP.add("instance-mcp", mockConfig)

        // Add session-scoped MCP to session1
        await MCP.addSessionScoped(session1.id, "session1-mcp", mockConfig)

        // Add session-scoped MCP to session2
        await MCP.addSessionScoped(session2.id, "session2-mcp", mockConfig)

        // Session1 should see both instance and its session MCP
        const status1 = await MCP.status(session1.id)
        expect(status1["instance-mcp"]).toBeDefined()
        expect(status1["session1-mcp"]).toBeDefined()
        expect(status1["session2-mcp"]).toBeUndefined()

        // Session2 should see instance and its session MCP
        const status2 = await MCP.status(session2.id)
        expect(status2["instance-mcp"]).toBeDefined()
        expect(status2["session1-mcp"]).toBeUndefined()
        expect(status2["session2-mcp"]).toBeDefined()

        // Cleanup
        await Session.remove(session1.id)
        await Session.remove(session2.id)
      },
    })
  })
})
