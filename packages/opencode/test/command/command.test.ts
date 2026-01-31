import { expect, test } from "bun:test"
import { Command } from "../../src/command"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import path from "path"

async function writeConfig(dir: string, config: object) {
  await Bun.write(path.join(dir, "opencode.json"), JSON.stringify(config))
}

test("filters commands using regex", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await writeConfig(dir, {
        command: {
          foo: {
            template: "foo",
            description: "foo",
          },
          bar: {
            template: "bar",
          },
        },
        command_filter: ["^bar$", "init$"],
      })
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const list = await Command.list()
      const names = list.map((item) => item.name)
      expect(names).toContain("foo")
      expect(names).not.toContain("bar")
      expect(names).not.toContain("init")
    },
  })
})
