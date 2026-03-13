import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionID } from "../../src/session/schema"
import { ExperimentalRoutes } from "../../src/server/routes/experimental"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("experimental tool route", () => {
  test("requires session id", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = ExperimentalRoutes()
        const query = new URLSearchParams({
          provider: "anthropic",
          model: "claude-sonnet-4-5",
        })

        const res = await app.request(`/tool?${query}`)

        expect(res.status).toBe(400)
      },
    })
  })

  test("passes session id into tool definitions", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const plugin = path.join(dir, ".opencode", "plugin")
        await fs.mkdir(plugin, { recursive: true })

        await Bun.write(
          path.join(plugin, "tool-definition.ts"),
          [
            "export default async () => ({",
            '  "tool.definition": async (input, output) => {',
            "    output.description = JSON.stringify(input)",
            "  },",
            "})",
            "",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const app = ExperimentalRoutes()
        const query = new URLSearchParams({
          provider: "anthropic",
          model: "claude-sonnet-4-5",
          sessionID: session.id,
        })

        const res = await app.request(`/tool?${query}`)
        expect(res.status).toBe(200)

        const body = (await res.json()) as { id: string; description: string; parameters: unknown }[]
        const bash = body.find((item) => item.id === "bash")
        expect(bash).toBeDefined()
        expect(JSON.parse(bash!.description)).toEqual({
          toolID: "bash",
          sessionID: session.id,
        })

        await Session.remove(session.id)
      },
    })
  })

  test("returns 404 for a missing session", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = ExperimentalRoutes()
        const query = new URLSearchParams({
          provider: "anthropic",
          model: "claude-sonnet-4-5",
          sessionID: SessionID.descending(),
        })

        const res = await app.request(`/tool?${query}`)

        expect(res.status).toBe(404)
      },
    })
  })

  test("returns 400 for an invalid session id", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = ExperimentalRoutes()
        const query = new URLSearchParams({
          provider: "anthropic",
          model: "claude-sonnet-4-5",
          sessionID: "bad-session-id",
        })

        const res = await app.request(`/tool?${query}`)

        expect(res.status).toBe(400)
      },
    })
  })
})
