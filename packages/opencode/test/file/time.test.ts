import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("FileTime", () => {
  describe("clearSession", () => {
    test("clears read times for a session and returns true", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const { FileTime } = await import("../../src/file/time")

          // Record some reads
          FileTime.read("session-1", "/path/to/file1.ts")
          FileTime.read("session-1", "/path/to/file2.ts")
          FileTime.read("session-2", "/path/to/file3.ts")

          expect(FileTime.sessionCount()).toBe(2)
          expect(FileTime.get("session-1", "/path/to/file1.ts")).toBeDefined()
          expect(FileTime.get("session-1", "/path/to/file2.ts")).toBeDefined()
          expect(FileTime.get("session-2", "/path/to/file3.ts")).toBeDefined()

          // Clear session-1
          const result = FileTime.clearSession("session-1")
          expect(result).toBe(true)

          // Verify session-1 data is gone
          expect(FileTime.get("session-1", "/path/to/file1.ts")).toBeUndefined()
          expect(FileTime.get("session-1", "/path/to/file2.ts")).toBeUndefined()

          // Verify session-2 data is still there
          expect(FileTime.get("session-2", "/path/to/file3.ts")).toBeDefined()

          expect(FileTime.sessionCount()).toBe(1)
        },
      })
    })

    test("returns false for non-existent session", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const { FileTime } = await import("../../src/file/time")

          const result = FileTime.clearSession("non-existent-session")
          expect(result).toBe(false)
        },
      })
    })
  })

  describe("sessionCount", () => {
    test("returns correct count of tracked sessions", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const { FileTime } = await import("../../src/file/time")

          expect(FileTime.sessionCount()).toBe(0)

          FileTime.read("session-a", "/file1.ts")
          expect(FileTime.sessionCount()).toBe(1)

          FileTime.read("session-b", "/file2.ts")
          expect(FileTime.sessionCount()).toBe(2)

          FileTime.read("session-a", "/file3.ts") // Same session
          expect(FileTime.sessionCount()).toBe(2)

          FileTime.clearSession("session-a")
          expect(FileTime.sessionCount()).toBe(1)
        },
      })
    })
  })
})
