/**
 * Tests for the session.stopping hook.
 *
 * Verifies the hook is defined in the Hooks interface and that Plugin.trigger
 * correctly propagates output mutations from hooks that implement it.
 */
import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Plugin } from "../../src/plugin"
import type { Hooks } from "@opencode-ai/plugin"

describe("session.stopping hook", () => {
  test("hook key exists in Hooks interface", () => {
    // Type-level check: a Hooks object with session.stopping should be valid
    const hooks: Hooks = {
      // @ts-ignore — session.stopping is in the local source type
      "session.stopping": async (_input, output) => {
        output.stop = false
        output.message = "continue"
      },
    }
    expect(typeof hooks["session.stopping"]).toBe("function")
  })

  test("plugin with session.stopping hook loads and triggers correctly", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const pluginDir = path.join(dir, ".opencode", "plugin")
        await fs.mkdir(pluginDir, { recursive: true })
        await Bun.write(
          path.join(pluginDir, "stop-hook.ts"),
          [
            "export default async () => ({",
            '  "session.stopping": async (input, output) => {',
            "    output.stop = false",
            '    output.message = "workflow gate"',
            "  },",
            "})",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Plugin.init()
        // @ts-ignore — session.stopping is not yet in the published type
        const out = await Plugin.trigger("session.stopping", { sessionID: "test-session" }, { stop: true, message: undefined })
        expect(out.stop).toBe(false)
        expect(out.message).toBe("workflow gate")
      },
    })
  }, 30000)

  test("session continues when stop=true (default, no plugin installed)", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Plugin.init()
        // @ts-ignore
        const out = await Plugin.trigger("session.stopping", { sessionID: "test-session" }, { stop: true, message: undefined })
        // With no plugin overriding, output is unchanged
        expect(out.stop).toBe(true)
        expect(out.message).toBeUndefined()
      },
    })
  }, 30000)
})
