import path from "path"
import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("Instance.setDirectory", () => {
  test("changes the active directory inside the current instance", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, "pkg", ".gitkeep"), "")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect(Instance.directory).toBe(tmp.path)

        const next = await Instance.setDirectory("pkg")

        expect(next.directory).toBe(path.join(tmp.path, "pkg"))
        expect(next.worktree).toBe(tmp.path)
        expect(next.previousDirectory).toBe(tmp.path)
        expect(Instance.directory).toBe(path.join(tmp.path, "pkg"))
        expect(Instance.worktree).toBe(tmp.path)
      },
    })
  })
})
