import { describe, expect, test } from "bun:test"
import { MaxUploadBytes, MaxUploadRequestBytes, UploadPathPattern } from "@opencode-ai/protocol/groups/fs"

describe("UploadPathPattern", () => {
  test("accepts valid relative paths", () => {
    for (const value of ["a", "a/b", "dir/file.txt", "héllo.txt", "a b/c", "foo.bar", "a-b_c.txt"]) {
      expect(UploadPathPattern.test(value), value).toBe(true)
    }
  })

  test("rejects empty, absolute and traversal paths", () => {
    for (const value of ["", ".", "..", "/abs", "a//b", "a/../b", "a/.", "a/..", "./a", "../a", "a/"]) {
      expect(UploadPathPattern.test(value), value).toBe(false)
    }
  })
})

describe("upload size limits", () => {
  test("request body limit covers multipart overhead", () => {
    expect(MaxUploadRequestBytes).toBeGreaterThan(MaxUploadBytes)
  })
})
