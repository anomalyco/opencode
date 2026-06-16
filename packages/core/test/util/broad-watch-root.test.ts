import { describe, expect, test } from "bun:test"
import { isBroadWatchRoot, normalizeWatchRootPath } from "@opencode-ai/core/util/broad-watch-root"

describe("normalizeWatchRootPath", () => {
  test("collapses duplicate slashes and parent segments", () => {
    expect(normalizeWatchRootPath("/home/user/../user/repo")).toBe("/home/user/repo")
  })
})

describe("isBroadWatchRoot (browser-safe)", () => {
  test("treats filesystem root and tilde as broad", () => {
    expect(isBroadWatchRoot("/")).toBe(true)
    expect(isBroadWatchRoot("~")).toBe(true)
    expect(isBroadWatchRoot("")).toBe(true)
  })

  test("treats typical unix user home paths as broad without homeDir", () => {
    expect(isBroadWatchRoot("/home/justin")).toBe(true)
    expect(isBroadWatchRoot("/Users/justin")).toBe(true)
  })

  test("matches an explicit home directory", () => {
    expect(isBroadWatchRoot("/home/justin", "/home/justin")).toBe(true)
    expect(isBroadWatchRoot("/home/justin/Projects/demo", "/home/justin")).toBe(false)
  })

  test("allows normal project directories", () => {
    expect(isBroadWatchRoot("/home/justin/Projects/demo")).toBe(false)
    expect(isBroadWatchRoot("/var/www/app")).toBe(false)
  })
})
