import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("Instance.setDirectory", () => {
  test("changes directory context within same project", async () => {
    await using tmp = await tmpdir({ git: true })
    const subdir = path.join(tmp.path, "subdir")
    await Bun.write(path.join(subdir, "file.txt"), "test")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect(Instance.directory).toBe(tmp.path)

        const result = await Instance.setDirectory(subdir)

        expect(result.directory).toBe(subdir)
        expect(Instance.directory).toBe(subdir)
        expect(Instance.worktree).toBe(tmp.path) // worktree stays the same
      },
    })
  })

  test("resolves relative paths from current directory", async () => {
    await using tmp = await tmpdir({ git: true })
    const subdir = path.join(tmp.path, "subdir")
    await Bun.write(path.join(subdir, "file.txt"), "test")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await Instance.setDirectory("./subdir")

        expect(result.directory).toBe(subdir)
        expect(Instance.directory).toBe(subdir)
      },
    })
  })

  test("throws error for non-existent directory", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(Instance.setDirectory("/nonexistent/path")).rejects.toThrow("Directory not found")
      },
    })
  })

  test("throws error when path is a file, not directory", async () => {
    await using tmp = await tmpdir({ git: true })
    const filepath = path.join(tmp.path, "file.txt")
    await Bun.write(filepath, "test")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(Instance.setDirectory(filepath)).rejects.toThrow("Directory not found")
      },
    })
  })

  test("can change to a different git worktree", async () => {
    await using tmp1 = await tmpdir({ git: true })
    await using tmp2 = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp1.path,
      fn: async () => {
        const originalProjectID = Instance.project.id
        expect(Instance.directory).toBe(tmp1.path)

        const result = await Instance.setDirectory(tmp2.path)

        expect(result.directory).toBe(tmp2.path)
        expect(Instance.directory).toBe(tmp2.path)
        expect(Instance.worktree).toBe(tmp2.path)
        // Project ID will be different since different git repos
        expect(result.project.id).not.toBe(originalProjectID)
        // Instance.project should also be updated
        expect(Instance.project.id).toBe(result.project.id)
      },
    })
  })
})
