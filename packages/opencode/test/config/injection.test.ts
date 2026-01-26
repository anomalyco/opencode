import { test, expect, describe } from "bun:test"
import { Injection } from "../../src/config/injection"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("Injection", () => {
  test("processes !`command` syntax", async () => {
    await using tmp = await tmpdir({})
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const content = "Hello\n!`echo world`\nBye"
        const processed = await Injection.process(content)
        expect(processed).toBe("Hello\nworld\nBye")
      },
    })
  })

  test("processes multiple commands in one line", async () => {
    await using tmp = await tmpdir({})
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const content = "!`echo a` !`echo b`"
        const processed = await Injection.process(content)
        expect(processed).toBe("a b")
      },
    })
  })

  test("ignores lines without backticks", async () => {
    await using tmp = await tmpdir({})
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const content = "Hello\n!echo world\nBye"
        const processed = await Injection.process(content)
        expect(processed).toBe(content)
      },
    })
  })

  test("handles command error", async () => {
    await using tmp = await tmpdir({})
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const content = "!`nonexistentcommand`"
        const processed = await Injection.process(content)
        expect(processed).toContain("Error executing command")
      },
    })
  })
})
