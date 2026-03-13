import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Agent } from "../../src/agent/agent"
import { getAvailableTools } from "../../src/cli/cmd/debug/agent"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("debug agent tool list", () => {
  test("passes session id into tool definitions", async () => {
    await using tmp = await tmpdir({
      git: true,
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
        const agent = await Agent.get("build")
        if (!agent) throw new Error("expected build agent")
        const tools = await getAvailableTools(agent, session.id)
        const bash = tools.find((item) => item.id === "bash")

        expect(bash).toBeDefined()
        expect(JSON.parse(bash!.description)).toEqual({
          toolID: "bash",
          sessionID: session.id,
        })

        await Session.remove(session.id)
      },
    })
  })
})
