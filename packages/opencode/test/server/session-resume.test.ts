import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Instance } from "../../src/project/instance"
import { InstanceBootstrap } from "../../src/project/bootstrap"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { SessionStart } from "../../src/session/start"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })
const root = path.join(__dirname, "../..")

describe("session resume endpoint", () => {
  test("runs resume hooks for existing sessions", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const dirp = path.join(dir, ".opencode", "plugin")
        await fs.mkdir(dirp, { recursive: true })
        await Bun.write(
          path.join(dirp, "session-start.ts"),
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

    const sessionID = await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () => {
        const session = await Session.create({})
        await SessionStart.clear(session.id)
        return session.id
      },
    })

    const app = Server.Default()
    const res = await app.request(`/session/${sessionID}/resume`, {
      method: "POST",
      headers: {
        "x-opencode-directory": tmp.path,
      },
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toBe(true)

    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () => {
        expect(await SessionStart.take(sessionID)).toEqual([`resume:${sessionID}`])
        await Session.remove(sessionID)
      },
    })
  })

  test("returns 404 for missing sessions", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const app = Server.Default()
        const res = await app.request("/session/ses_missing/resume", {
          method: "POST",
          headers: {
            "x-opencode-directory": root,
          },
        })

        expect(res.status).toBe(404)
      },
    })
  })
})
