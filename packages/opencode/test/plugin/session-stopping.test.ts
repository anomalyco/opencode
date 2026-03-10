import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Plugin } from "../../src/plugin"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"

describe("session.stopping hook", () => {
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
        const out = await Plugin.trigger("session.stopping", { sessionID: "test-session" }, { stop: true, message: undefined as string | undefined })
        expect(out.stop).toBe(false)
        expect(out.message).toBe("workflow gate")
      },
    })
  }, 30000)

  test("no plugin installed — stop stays true", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Plugin.init()
        const out = await Plugin.trigger("session.stopping", { sessionID: "test-session" }, { stop: true, message: undefined as string | undefined })
        expect(out.stop).toBe(true)
        expect(out.message).toBeUndefined()
      },
    })
  }, 30000)

  test("stop=false without message does not satisfy re-entry condition", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const pluginDir = path.join(dir, ".opencode", "plugin")
        await fs.mkdir(pluginDir, { recursive: true })
        await Bun.write(
          path.join(pluginDir, "no-msg.ts"),
          ["export default async () => ({", '  "session.stopping": async (_input, output) => {', "    output.stop = false", "  },", "})"].join("\n"),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Plugin.init()
        const out = await Plugin.trigger("session.stopping", { sessionID: "test-session" }, { stop: true, message: undefined as string | undefined })
        expect(out.stop).toBe(false)
        expect(out.message).toBeUndefined()
      },
    })
  }, 30000)

  test("hook message is persisted as a user message in the session", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        const pluginDir = path.join(dir, ".opencode", "plugin")
        await fs.mkdir(pluginDir, { recursive: true })
        await Bun.write(
          path.join(pluginDir, "gate.ts"),
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

        const out = await Plugin.trigger("session.stopping", { sessionID: session.id }, { stop: true, message: undefined as string | undefined })
        expect(out.stop).toBe(false)
        expect(out.message).toBe("resume from gate")

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
