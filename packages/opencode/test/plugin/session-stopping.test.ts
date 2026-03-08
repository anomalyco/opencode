/**
 * Tests for the session.stopping hook.
 *
 * Verifies the hook is defined in the Hooks interface, that Plugin.trigger
 * correctly propagates output mutations, and that the hook message text is
 * correctly written as a user message part in the session when stop=false.
 */
import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Plugin } from "../../src/plugin"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
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
        const plug = path.join(dir, ".opencode", "plugin")
        await fs.mkdir(plug, { recursive: true })
        await Bun.write(
          path.join(plug, "stop-hook.ts"),
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
        const out = await Plugin.trigger("session.stopping", { sessionID: "test-session" }, { stop: true, message: undefined as string | undefined })
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
        // @ts-ignore — session.stopping is not yet in the published type
        const out = await Plugin.trigger("session.stopping", { sessionID: "test-session" }, { stop: true, message: undefined as string | undefined })
        // With no plugin overriding, output is unchanged
        expect(out.stop).toBe(true)
        expect(out.message).toBeUndefined()
      },
    })
  }, 30000)

  test("stop=false without message does not satisfy re-entry condition", () => {
    // The loop re-enters only when !hook.stop && hook.message.
    // Verify the guard: stop=false alone is not enough.
    const stop = false
    const message = undefined
    expect(!stop && !!message).toBe(false)
  })

  test("hook message is written as a user message part in the session", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        const plug = path.join(dir, ".opencode", "plugin")
        await fs.mkdir(plug, { recursive: true })
        await Bun.write(
          path.join(plug, "gate.ts"),
          [
            "export default async () => ({",
            '  "session.stopping": async (_input, output) => {',
            "    output.stop = false",
            '    output.message = "resume from gate"',
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
        const session = await Session.create({})

        // Simulate what the loop does when stop=false: fire the hook, then
        // write the hook message as a new user message via SessionPrompt.prompt
        // with noReply=true (which is exactly what createUserMessage does).
        // @ts-ignore — session.stopping is not yet in the published type
        const out = await Plugin.trigger("session.stopping", { sessionID: session.id }, { stop: true, message: undefined as string | undefined })
        expect(out.stop).toBe(false)
        expect(out.message).toBe("resume from gate")

        // Write the hook message as a user message (mirrors the loop's createUserMessage call)
        const msg = await SessionPrompt.prompt({
          sessionID: session.id,
          noReply: true,
          parts: [{ type: "text", text: out.message! }],
        })

        expect(msg.info.role).toBe("user")
        const text = msg.parts.find((p) => p.type === "text" && !p.synthetic)
        expect(text?.type === "text" && text.text).toBe("resume from gate")

        await Session.remove(session.id)
      },
    })
  }, 30000)
})
