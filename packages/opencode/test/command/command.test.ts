import { describe, expect, test } from "bun:test"
import { Command } from "../../src/command"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("command.list", () => {
  test("includes built-in ask command", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const commands = await Command.list()
        const names = commands.map((item) => item.name)
        expect(names).toContain("ask")
      },
    })
  })
})
