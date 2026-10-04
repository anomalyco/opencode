import { describe, expect, test } from "bun:test"
import { directoryKey } from "../../src/util/project"

describe("directoryKey", () => {
  test("keeps plain directories as-is", () => {
    expect(directoryKey("/repo/api")).toBe("/repo/api")
  })

  test("merges trailing-slash variants into one group", () => {
    expect(directoryKey("/repo/api/")).toBe(directoryKey("/repo/api"))
  })

  test("keeps the filesystem root intact", () => {
    expect(directoryKey("/")).toBe("/")
    expect(directoryKey("///")).toBe("/")
  })

  test("maps a missing directory to the unknown group", () => {
    expect(directoryKey(undefined)).toBe("")
  })

  test("keeps same-name folders in distinct groups", () => {
    expect(directoryKey("/a/api")).not.toBe(directoryKey("/b/api"))
  })
})
