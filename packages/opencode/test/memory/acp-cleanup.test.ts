import { test, expect, describe } from "bun:test"
import { ACP } from "../../src/acp/agent"

/**
 * Tests for ACP Agent session cleanup.
 * Verifies that session event subscriptions are properly cleaned up.
 */

describe("ACP.Agent session cleanup", () => {
  test("cleanupSession removes abort controller", () => {
    // Create a mock connection and config
    const mockConnection = {
      requestPermission: async () => ({ outcome: { outcome: "selected", optionId: "once" } }),
      sessionUpdate: async () => {},
      closed: new Promise(() => {}), // Never resolves during test
    }

    const mockConfig = {
      sdk: {
        event: {
          subscribe: async () => ({
            stream: (async function* () {
              // Empty stream
            })(),
          }),
        },
        permission: {
          reply: async () => {},
        },
        session: {
          message: async () => ({ data: null }),
          abort: async () => {},
        },
      },
    }

    // @ts-expect-error - testing with mocks
    const agent = new ACP.Agent(mockConnection, mockConfig)

    // Access private map for testing
    // @ts-expect-error - accessing private for testing
    const controllers = agent.sessionAbortControllers

    // Simulate adding a controller
    const controller = new AbortController()
    controllers.set("test-session-1", controller)

    expect(controllers.size).toBe(1)
    expect(controller.signal.aborted).toBe(false)

    // Call cleanup
    // @ts-expect-error - accessing private for testing
    agent.cleanupSession("test-session-1")

    expect(controllers.size).toBe(0)
    expect(controller.signal.aborted).toBe(true)
  })

  test("dispose cleans up all session controllers", () => {
    const mockConnection = {
      closed: new Promise(() => {}), // Never resolves during test
    }
    const mockConfig = {
      sdk: {
        event: { subscribe: async () => ({ stream: (async function* () {})() }) },
        permission: { reply: async () => {} },
        session: { message: async () => ({ data: null }), abort: async () => {} },
      },
    }

    // @ts-expect-error - testing with mocks
    const agent = new ACP.Agent(mockConnection, mockConfig)

    // @ts-expect-error - accessing private for testing
    const controllers = agent.sessionAbortControllers

    // Add multiple controllers
    const controller1 = new AbortController()
    const controller2 = new AbortController()
    const controller3 = new AbortController()

    controllers.set("session-1", controller1)
    controllers.set("session-2", controller2)
    controllers.set("session-3", controller3)

    expect(controllers.size).toBe(3)

    // Dispose all
    agent.dispose()

    expect(controllers.size).toBe(0)
    expect(controller1.signal.aborted).toBe(true)
    expect(controller2.signal.aborted).toBe(true)
    expect(controller3.signal.aborted).toBe(true)
  })

  test("setupEventSubscriptions replaces existing subscription for same session", () => {
    const mockConnection = {
      closed: new Promise(() => {}), // Never resolves during test
    }
    const subscribeCallCount = { count: 0 }
    // Track active generators so we can verify they terminate
    const activeGenerators = new Set<AbortController>()
    const mockConfig = {
      sdk: {
        event: {
          subscribe: async () => {
            subscribeCallCount.count++
            // Create a signal to control this generator's lifecycle
            const genController = new AbortController()
            activeGenerators.add(genController)
            return {
              stream: (async function* () {
                // Use finite loop with abort check to prevent background runaway
                for (let i = 0; i < 100 && !genController.signal.aborted; i++) {
                  await new Promise((r) => setTimeout(r, 100))
                  if (genController.signal.aborted) break
                  yield { type: "test" }
                }
                activeGenerators.delete(genController)
              })(),
              // Expose abort to allow cleanup
              abort: () => genController.abort(),
            }
          },
        },
        permission: { reply: async () => {} },
        session: { message: async () => ({ data: null }), abort: async () => {} },
      },
    }

    // @ts-expect-error - testing with mocks
    const agent = new ACP.Agent(mockConnection, mockConfig)

    // @ts-expect-error - accessing private for testing
    const controllers = agent.sessionAbortControllers

    // Manually add an existing controller to simulate an existing subscription
    const existingController = new AbortController()
    controllers.set("session-1", existingController)

    // Setup event subscriptions for the same session
    const mockSession = { id: "session-1", cwd: "/test" }
    // @ts-expect-error - accessing private for testing
    agent.setupEventSubscriptions(mockSession)

    // The existing controller should be aborted
    expect(existingController.signal.aborted).toBe(true)

    // A new controller should exist
    expect(controllers.has("session-1")).toBe(true)
    const newController = controllers.get("session-1")
    expect(newController).not.toBe(existingController)
    expect(newController?.signal.aborted).toBe(false)

    // Cleanup
    agent.dispose()
  })
})
