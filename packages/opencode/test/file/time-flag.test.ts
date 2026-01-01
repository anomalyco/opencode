import { test, expect, describe, afterEach } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("FileTime with OPENCODE_DISABLE_FILETIME_CHECK flag", () => {
  const originalFlagEnv = process.env.OPENCODE_DISABLE_FILETIME_CHECK

  afterEach(() => {
    if (originalFlagEnv === undefined) {
      delete process.env.OPENCODE_DISABLE_FILETIME_CHECK
    } else {
      process.env.OPENCODE_DISABLE_FILETIME_CHECK = originalFlagEnv
    }
  })

  async function loadModules() {
    try {
      const cacheBust = `${Date.now()}-${Math.random().toString(36)}`
      const [{ FileTime }, { Flag }] = await Promise.all([
        import(`../../src/file/time?cacheBust=${cacheBust}`),
        import(`../../src/flag/flag?cacheBust=${cacheBust}`),
      ])
      return { FileTime, Flag }
    } catch (error) {
      throw new Error(`Failed to load modules: ${String(error)}`)
    }
  }

  test("should skip check when flag is true", async () => {
    process.env.OPENCODE_DISABLE_FILETIME_CHECK = "true"
    const { FileTime, Flag } = await loadModules()
    expect(Flag.OPENCODE_DISABLE_FILETIME_CHECK).toBe(true)

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const testFile = path.join(tmp.path, "test-flag-skip.txt")
        await Bun.write(testFile, "initial content")

        try {
          const result = await FileTime.assert("test-session-skip", testFile)
          expect(result).toBeUndefined()
        } finally {
          await Bun.file(testFile).delete()
        }
      },
    })
  })

  test("should enforce check when flag is false", async () => {
    process.env.OPENCODE_DISABLE_FILETIME_CHECK = "false"
    const { FileTime, Flag } = await loadModules()
    expect(Flag.OPENCODE_DISABLE_FILETIME_CHECK).toBe(false)

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const testFile = path.join(tmp.path, "test-flag-enforce.txt")
        await Bun.write(testFile, "initial content")

        try {
          await expect(FileTime.assert("test-session-enforce", testFile)).rejects.toThrow("You must read file")
        } finally {
          await Bun.file(testFile).delete()
        }
      },
    })
  })
})
