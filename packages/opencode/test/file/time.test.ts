import { describe, expect, test, beforeEach } from "bun:test"
import { FileTime } from "../../src/file/time"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import path from "path"

describe("FileTime.assert - tolerance (#11436)", () => {
  test("allows file with mtime within 100ms tolerance", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = path.join(tmp.path, "test.txt")
        await Bun.write(file, "content")

        FileTime.read("test-session", file)

        // Should not throw - mtime is within tolerance
        await expect(FileTime.assert("test-session", file)).resolves.toBeUndefined()
      },
    })
  })

  test("throws when file is modified after read", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = path.join(tmp.path, "test.txt")
        await Bun.write(file, "content")

        FileTime.read("test-session", file)

        // Wait and modify file
        await new Promise((r) => setTimeout(r, 150))
        await Bun.write(file, "modified content")

        await expect(FileTime.assert("test-session", file)).rejects.toThrow(/has been modified/)
      },
    })
  })

  test("throws when file was never read", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = path.join(tmp.path, "test.txt")
        await Bun.write(file, "content")

        await expect(FileTime.assert("test-session", file)).rejects.toThrow(/must read file/)
      },
    })
  })
})
