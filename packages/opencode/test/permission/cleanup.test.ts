import { test, expect } from "bun:test"
import { PermissionNext } from "../../src/permission/next"
import { Bus } from "../../src/bus"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { tmpdir } from "../fixture/fixture"

test("clearSession - rejects pending permissions for session", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await PermissionNext.init()
      try {
        // Create a pending permission by asking with "ask" action
        const askPromise = PermissionNext.ask({
          id: "permission_cleanup_test1",
          sessionID: "session_to_reject",
          permission: "bash",
          patterns: ["dangerous_command"],
          metadata: {},
          always: [],
          ruleset: [], // Empty ruleset means default to "ask"
        })

        // Catch rejection to prevent unhandled promise rejection
        const result = askPromise.catch((e) => e)

        // Verify pending exists
        const pending = await PermissionNext.list()
        expect(pending.length).toBe(1)
        expect(pending[0].sessionID).toBe("session_to_reject")

        // Clear the session - should reject pending
        await PermissionNext.clearSession("session_to_reject")

        // Verify pending was rejected
        const error = await result
        expect(error).toBeInstanceOf(PermissionNext.RejectedError)
        expect((await PermissionNext.list()).length).toBe(0)
      } finally {
        await PermissionNext.dispose()
      }
    },
  })
})

test("clearSession - does not affect other sessions", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await PermissionNext.init()
      try {
        // Create pending permissions for two sessions
        const askPromise1 = PermissionNext.ask({
          id: "permission_cleanup_test2",
          sessionID: "session_keep",
          permission: "bash",
          patterns: ["ls"],
          metadata: {},
          always: [],
          ruleset: [],
        })

        const askPromise2 = PermissionNext.ask({
          id: "permission_cleanup_test3",
          sessionID: "session_clear",
          permission: "edit",
          patterns: ["file.ts"],
          metadata: {},
          always: [],
          ruleset: [],
        })

        // Catch rejection for the one we'll clear
        const result1 = askPromise1.catch((e) => e)
        const result2 = askPromise2.catch((e) => e)

        // Verify both pending
        expect((await PermissionNext.list()).length).toBe(2)

        // Clear only one session
        await PermissionNext.clearSession("session_clear")

        // Verify only session_keep remains
        const remaining = await PermissionNext.list()
        expect(remaining.length).toBe(1)
        expect(remaining[0].sessionID).toBe("session_keep")

        // Verify session_clear was rejected
        expect(await result2).toBeInstanceOf(PermissionNext.RejectedError)

        // Clean up session_keep
        await PermissionNext.reply({
          requestID: "permission_cleanup_test2",
          reply: "once",
        })
        await result1
      } finally {
        await PermissionNext.dispose()
      }
    },
  })
})

test("init - subscribes to session.deleted and clears session", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await PermissionNext.init()
      try {
        // Create a pending permission
        const askPromise = PermissionNext.ask({
          id: "permission_cleanup_test4",
          sessionID: "session_deleted",
          permission: "bash",
          patterns: ["ls"],
          metadata: {},
          always: [],
          ruleset: [],
        })

        // Catch rejection
        const result = askPromise.catch((e) => e)

        // Verify pending exists
        expect((await PermissionNext.list()).length).toBe(1)

        // Simulate session deletion by publishing the event
        // Bus.publish returns a Promise that resolves when all handlers complete
        await Bus.publish(Session.Event.Deleted, {
          info: {
            id: "session_deleted",
            projectID: "project_1",
            directory: tmp.path,
            title: "Test Session",
            version: "1.0.0",
            time: {
              created: Date.now(),
              updated: Date.now(),
            },
          },
        })

        // Verify pending was cleared
        expect((await PermissionNext.list()).length).toBe(0)
        expect(await result).toBeInstanceOf(PermissionNext.RejectedError)
      } finally {
        await PermissionNext.dispose()
      }
    },
  })
})

test("dispose - unsubscribes from events", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await PermissionNext.init()

      // Create a pending permission
      const askPromise = PermissionNext.ask({
        id: "permission_cleanup_test5",
        sessionID: "session_after_dispose",
        permission: "bash",
        patterns: ["ls"],
        metadata: {},
        always: [],
        ruleset: [],
      })

      // Dispose the subscription
      await PermissionNext.dispose()

      // Verify pending still exists
      expect((await PermissionNext.list()).length).toBe(1)

      // Publish session deleted event - should NOT clear because we disposed
      await Bus.publish(Session.Event.Deleted, {
        info: {
          id: "session_after_dispose",
          projectID: "project_1",
          directory: tmp.path,
          title: "Test Session",
          version: "1.0.0",
          time: {
            created: Date.now(),
            updated: Date.now(),
          },
        },
      })

      // Pending should still exist because we disposed
      expect((await PermissionNext.list()).length).toBe(1)

      // Manually clear for cleanup
      await PermissionNext.clearSession("session_after_dispose")
      await askPromise.catch(() => {})
    },
  })
})

test("init - calling init twice does not duplicate subscriptions", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      // Call init multiple times (it calls dispose first internally)
      await PermissionNext.init()
      await PermissionNext.init()
      await PermissionNext.init()

      try {
        // Create a pending permission
        const askPromise = PermissionNext.ask({
          id: "permission_cleanup_test6",
          sessionID: "session_multi_init",
          permission: "bash",
          patterns: ["ls"],
          metadata: {},
          always: [],
          ruleset: [],
        })

        const result = askPromise.catch((e) => e)

        // Publish session deleted event
        await Bus.publish(Session.Event.Deleted, {
          info: {
            id: "session_multi_init",
            projectID: "project_1",
            directory: tmp.path,
            title: "Test Session",
            version: "1.0.0",
            time: {
              created: Date.now(),
              updated: Date.now(),
            },
          },
        })

        // Should be cleared exactly once (no duplicate handlers)
        expect((await PermissionNext.list()).length).toBe(0)
        expect(await result).toBeInstanceOf(PermissionNext.RejectedError)
      } finally {
        await PermissionNext.dispose()
      }
    },
  })
})
