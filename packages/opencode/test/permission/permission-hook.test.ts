import { afterEach, expect, spyOn, test } from "bun:test"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { Instance } from "../../src/project/instance"
import { SessionID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

async function waitForPending(count: number) {
  for (let i = 0; i < 100; i++) {
    const list = await Permission.list()
    if (list.length === count) return list
    await Bun.sleep(10)
  }
  return Permission.list()
}

/**
 * Regression test for #19927:
 * permission.ask plugin hook was inside an `if (!needsAsk)` guard,
 * so it never fired for first-encounter commands (needsAsk=true).
 */

test("permission.ask hook fires for first-encounter commands (needsAsk=true)", async () => {
  const triggerSpy = spyOn(Plugin, "trigger").mockImplementation(
    async (_name: any, _input: any, output: any) => output,
  )

  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const promise = Permission.ask({
        sessionID: SessionID.make("session_test"),
        permission: "bash",
        patterns: ["ls"],
        metadata: {},
        always: [],
        // "ask" ruleset means needsAsk=true for this pattern
        ruleset: [{ permission: "bash", pattern: "*", action: "ask" }],
      })

      // Wait for the permission to become pending (async hook trigger adds latency)
      await waitForPending(1)

      expect(triggerSpy).toHaveBeenCalledWith(
        "permission.ask",
        expect.objectContaining({
          sessionID: "session_test",
          permission: "bash",
          patterns: ["ls"],
        }),
        { status: "ask" },
      )

      // Clean up pending permission
      const list = await Permission.list()
      for (const req of list) {
        await Permission.reply({ requestID: req.id, reply: "reject" })
      }
      await promise.catch(() => {})
    },
  })

  triggerSpy.mockRestore()
})

test("permission.ask hook fires for already-allowed commands (needsAsk=false)", async () => {
  const triggerSpy = spyOn(Plugin, "trigger").mockImplementation(
    async (_name: any, _input: any, output: any) => output,
  )

  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await Permission.ask({
        sessionID: SessionID.make("session_test"),
        permission: "bash",
        patterns: ["ls"],
        metadata: {},
        always: [],
        ruleset: [{ permission: "bash", pattern: "*", action: "allow" }],
      })

      expect(triggerSpy).toHaveBeenCalledWith(
        "permission.ask",
        expect.objectContaining({
          permission: "bash",
          patterns: ["ls"],
        }),
        { status: "allow" },
      )
    },
  })

  triggerSpy.mockRestore()
})

test("permission.ask hook can override ask to allow", async () => {
  const triggerSpy = spyOn(Plugin, "trigger").mockImplementation(
    async (_name: any, _input: any, output: any) => {
      return { ...output, status: "allow" }
    },
  )

  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      // With "ask" ruleset, needsAsk=true. But hook overrides to "allow".
      const result = await Permission.ask({
        sessionID: SessionID.make("session_test"),
        permission: "bash",
        patterns: ["ls"],
        metadata: {},
        always: [],
        ruleset: [{ permission: "bash", pattern: "*", action: "ask" }],
      })

      // Should resolve immediately (no pending permission dialog)
      expect(result).toBeUndefined()
      expect(await Permission.list()).toHaveLength(0)
    },
  })

  triggerSpy.mockRestore()
})

test("permission.ask hook can override allow to deny", async () => {
  const triggerSpy = spyOn(Plugin, "trigger").mockImplementation(
    async (_name: any, _input: any, output: any) => {
      return { ...output, status: "deny" }
    },
  )

  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await expect(
        Permission.ask({
          sessionID: SessionID.make("session_test"),
          permission: "bash",
          patterns: ["ls"],
          metadata: {},
          always: [],
          ruleset: [{ permission: "bash", pattern: "*", action: "allow" }],
        }),
      ).rejects.toBeInstanceOf(Permission.DeniedError)
    },
  })

  triggerSpy.mockRestore()
})
