import { test, expect, describe } from "bun:test"
import path from "path"
import { FileTime } from "../../src/file/time"
import { Flag } from "../../src/flag/flag"
import { Instance } from "../../src/project/instance"

describe("FileTime with OPENCODE_DISABLE_FILETIME_CHECK flag", () => {
  const projectRoot = path.join(__dirname, "../..")

  test("should skip check when flag is true", async () => {
    const originalFlag = Flag.OPENCODE_DISABLE_FILETIME_CHECK

    try {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          Flag.OPENCODE_DISABLE_FILETIME_CHECK = true

          const testFile = path.join(projectRoot, "test-flag-skip.txt")
          await Bun.write(testFile, "initial content")

          const result = await FileTime.assert("test-session-skip", testFile)
          expect(result).toBeUndefined()

          await Bun.file(testFile).delete()
        },
      })
    } finally {
      Flag.OPENCODE_DISABLE_FILETIME_CHECK = originalFlag
    }
  })

  test("should enforce check when flag is false", async () => {
    const originalFlag = Flag.OPENCODE_DISABLE_FILETIME_CHECK

    try {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          Flag.OPENCODE_DISABLE_FILETIME_CHECK = false

          const testFile = path.join(projectRoot, "test-flag-enforce.txt")
          await Bun.write(testFile, "initial content")

          await expect(FileTime.assert("test-session-enforce", testFile)).rejects.toThrow("You must read file")

          await Bun.file(testFile).delete()
        },
      })
    } finally {
      Flag.OPENCODE_DISABLE_FILETIME_CHECK = originalFlag
    }
  })
})
