import { describe, expect, test } from "bun:test"
import path from "path"
import { FileTime } from "../../src/file/time"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("file.time", () => {
  test("should track file read times", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        FileTime.read("test-session", "/path/to/file.ts")
        const time = FileTime.get("test-session", "/path/to/file.ts")
        expect(time).toBeInstanceOf(Date)
        FileTime.clear("test-session")
      },
    })
  })

  test("should return undefined for unread files", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const time = FileTime.get("test-session-2", "/unread/file.ts")
        expect(time).toBeUndefined()
      },
    })
  })

  test("should clear session data", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        FileTime.read("test-session-3", "/path/to/file.ts")
        FileTime.clear("test-session-3")
        const time = FileTime.get("test-session-3", "/path/to/file.ts")
        expect(time).toBeUndefined()
      },
    })
  })

  test("should evict oldest entries when exceeding limit", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const limit = 500
        for (let i = 0; i < limit + 50; i++) {
          FileTime.read("test-session-4", `/file-${i}.ts`)
        }

        const entries = FileTime.state().read["test-session-4"]
        const count = entries ? Object.keys(entries).length : 0
        expect(count).toBeLessThanOrEqual(limit)
        expect(FileTime.get("test-session-4", `/file-${limit + 49}.ts`)).toBeInstanceOf(Date)
        FileTime.clear("test-session-4")
      },
    })
  })
})
