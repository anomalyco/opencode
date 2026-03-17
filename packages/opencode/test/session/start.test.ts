import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { pathToFileURL } from "url"
import { Instance } from "../../src/project/instance"
import { InstanceBootstrap } from "../../src/project/bootstrap"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID } from "../../src/session/schema"
import { SessionStart } from "../../src/session/start"
import { tmpdir } from "../fixture/fixture"
import { Log } from "../../src/util/log"

Log.init({ print: false })

describe("session.start", () => {
  test("stores startup, resume, and compact context", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const pluginDir = path.join(dir, ".opencode", "plugin")
        await fs.mkdir(pluginDir, { recursive: true })
        await Bun.write(
          path.join(pluginDir, "session-start.ts"),
          [
            "export default async () => ({",
            '  "session.start": async (input, output) => {',
            "    output.additionalContext.push(`${input.trigger}:${input.sessionID}`)",
            "  },",
            "})",
            "",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () => {
        const session = await Session.create({})
        expect(await SessionStart.pending(session.id)).toEqual([`startup:${session.id}`])

        await SessionStart.trigger({ sessionID: session.id, trigger: "resume" })
        await SessionStart.trigger({ sessionID: session.id, trigger: "compact" })

        expect(await SessionStart.take(session.id)).toEqual([
          `startup:${session.id}`,
          `resume:${session.id}`,
          `compact:${session.id}`,
        ])
        expect(await SessionStart.pending(session.id)).toEqual([])

        await Session.remove(session.id)
      },
    })
  })

  test("logs and continues when plugin throws", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const pluginDir = path.join(dir, ".opencode", "plugin")
        await fs.mkdir(pluginDir, { recursive: true })
        await Bun.write(
          path.join(pluginDir, "session-start-throw.ts"),
          [
            "export default async () => ({",
            '  "session.start": async (input, output) => {',
            '    if (input.trigger === "resume") throw new Error("boom")',
            "    output.additionalContext.push(`ok:${input.trigger}`)",
            "  },",
            "})",
            "",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () => {
        const session = await Session.create({})
        expect(await SessionStart.pending(session.id)).toEqual(["ok:startup"])

        await expect(SessionStart.trigger({ sessionID: session.id, trigger: "resume" })).resolves.toEqual([])
        expect(await SessionStart.pending(session.id)).toEqual(["ok:startup"])

        await Session.remove(session.id)
      },
    })
  })

  test("fork startup hooks see an empty fork before message copy finishes", async () => {
    const mod = pathToFileURL(path.join(import.meta.dir, "../../src/session/index.ts")).href
    await using tmp = await tmpdir({
      init: async (dir) => {
        const dirp = path.join(dir, ".opencode", "plugin")
        await fs.mkdir(dirp, { recursive: true })
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            enabled_providers: ["anthropic"],
            provider: {
              anthropic: {
                options: {
                  apiKey: "test-key",
                },
              },
            },
          }),
        )
        await Bun.write(
          path.join(dirp, "session-start-fork.ts"),
          [
            `const { Session } = await import(${JSON.stringify(mod)})`,
            "export default async (input) => ({",
            '  "session.start": async (evt, output) => {',
            '    if (evt.trigger !== "startup") return',
            "    const msgs = await Session.messages({ sessionID: evt.sessionID })",
            "    output.additionalContext.push(`startup-count:${msgs.length}`)",
            "  },",
            "})",
            "",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () => {
        const parent = await Session.create({})
        const id = MessageID.ascending()
        await Session.updateMessage({
          id,
          sessionID: parent.id,
          role: "user",
          time: { created: Date.now() },
          agent: "test",
          model: { providerID: "anthropic", modelID: "claude-sonnet-4-5" },
          tools: {},
          mode: "",
        } as unknown as MessageV2.Info)
        await Session.updatePart({
          id: PartID.ascending(),
          sessionID: parent.id,
          messageID: id,
          type: "text",
          text: "hello",
        })

        const fork = await Session.fork({ sessionID: parent.id })

        expect(await SessionStart.take(fork.id)).toEqual(["startup-count:0"])
        expect((await Session.messages({ sessionID: fork.id })).length).toBe(1)

        await Session.remove(fork.id)
        await Session.remove(parent.id)
      },
    })
  })
})
