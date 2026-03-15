import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Instance } from "../../src/project/instance"
import { InstanceBootstrap } from "../../src/project/bootstrap"
import { Session } from "../../src/session"
import { SessionStart } from "../../src/session/start"
import { tmpdir } from "../fixture/fixture"
import { Log } from "../../src/util/log"

Log.init({ print: false })

describe("session.start", () => {
  test("stores startup, resume, and compact context", async () => {
    await using tmp = await tmpdir({
      git: true,
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
      git: true,
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
})
