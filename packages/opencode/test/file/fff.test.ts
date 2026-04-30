import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Fff } from "../../src/file/fff"

async function write(file: string, body: string) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, body)
}

afterEach(async () => {
  await Instance.disposeAll()
})

describe("file.fff", () => {
  test("allowed respects hidden filter", async () => {
    expect(Fff.allowed({ rel: "visible.txt", hidden: true })).toBe(true)
    expect(Fff.allowed({ rel: ".opencode/thing.json", hidden: true })).toBe(true)
    expect(Fff.allowed({ rel: ".opencode/thing.json", hidden: false })).toBe(false)
  })

  test("search returns empty when nothing matches", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await write(path.join(dir, "match.ts"), "const value = 'other'\n")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const hits = await Fff.search({
          cwd: tmp.path,
          pattern: "needle",
        })
        expect(hits).toEqual([])
      },
    })
  })

  test("tree builds and truncates", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.mkdir(path.join(dir, "a", "b"), { recursive: true })
        await write(path.join(dir, "a", "b", "c.ts"), "export const x = 1\n")
        await write(path.join(dir, "a", "d.ts"), "export const y = 1\n")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tree = await Fff.tree({ cwd: tmp.path, limit: 1 })
        expect(tree).toContain("a")
        expect(tree).toContain("truncated")
      },
    })
  })
})
