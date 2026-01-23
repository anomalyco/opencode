import { describe, expect, test } from "bun:test"
import path from "path"
import { pathToFileURL } from "url"
import { Agent } from "../../src/agent/agent"
import { Bus } from "../../src/bus"
import { Command } from "../../src/command"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

const pluginPath = path.resolve(__dirname, "../fixtures/plugins/toggle.ts")
const pluginUrl = pathToFileURL(pluginPath).href

Log.init({ print: false })

describe("plugin commands", () => {
  test("lists plugin commands", async () => {
    await using tmp = await tmpdir({
      config: {
        plugin: [pluginUrl],
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const commands = await Command.list()
        const names = commands.map((item) => item.name)
        expect(names).toContain("toggle")
      },
    })
  })

  test("executes plugin-only commands", async () => {
    await using tmp = await tmpdir({
      config: {
        plugin: [pluginUrl],
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const agent = await Agent.defaultAgent()
        const executed: {
          value:
            | {
                name: string
                sessionID: string
                arguments: string
                messageID: string
              }
            | undefined
        } = { value: undefined }
        const unsub = Bus.subscribe(Command.Event.Executed, (event) => {
          executed.value = event.properties as typeof executed.value
        })
        const result = await SessionPrompt.command({
          sessionID: session.id,
          command: "toggle",
          arguments: "on",
          agent,
        })
        await new Promise((resolve) => setTimeout(resolve, 20))
        unsub()
        const text = result.parts.find((part) => part.type === "text")
        expect(text?.type === "text" ? text.text : undefined).toBe("toggle:on")
        expect(executed.value?.name).toBe("toggle")
        expect(executed.value?.messageID).toBe(result.info.id)
        await Session.remove(session.id)
      },
    })
  })
})
