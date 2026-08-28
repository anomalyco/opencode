import { describe, expect, test } from "bun:test"
import { Wildcard } from "@opencode-ai/core/util/wildcard"

describe("Wildcard", () => {
  test("matches glob tokens", () => {
    expect(Wildcard.match("file1.txt", "file?.txt")).toBe(true)
    expect(Wildcard.match("file12.txt", "file?.txt")).toBe(false)
    expect(Wildcard.match("foo+bar", "foo+bar")).toBe(true)
    expect(Wildcard.match("src/foo.ts", "src/*.ts")).toBe(true)
    expect(Wildcard.match("src/foo.ts", "src/*.js")).toBe(false)
  })

  test("escaped glob characters match literally", () => {
    expect(Wildcard.match("config?.json", "config\\?.json")).toBe(true)
    expect(Wildcard.match("configX.json", "config\\?.json")).toBe(false)
    expect(Wildcard.match("*", "\\*")).toBe(true)
    expect(Wildcard.match("anything.ts", "\\*")).toBe(false)
    expect(Wildcard.match("a*b", "a\\*b")).toBe(true)
    expect(Wildcard.match("aXb", "a\\*b")).toBe(false)
  })

  test("escaped backslash matches a literal backslash", () => {
    expect(Wildcard.match("a\\b", "a\\\\b")).toBe(true)
    expect(Wildcard.match("a/b", "a\\\\b")).toBe(true)
    expect(Wildcard.match("aXb", "a\\\\b")).toBe(false)
  })

  test("trailing space plus wildcard matches commands with or without args", () => {
    expect(Wildcard.match("kill -9 44165", "kill *")).toBe(true)
    expect(Wildcard.match("ls", "ls *")).toBe(true)
    expect(Wildcard.match("git status", "git *")).toBe(true)
    expect(Wildcard.match("lstmeval", "ls *")).toBe(false)
  })

  test("normalizes slashes for cross-platform globbing", () => {
    expect(Wildcard.match("C:\\Windows\\System32\\drivers", "C:/Windows/System32/*")).toBe(true)
    expect(Wildcard.match("C:\\Windows\\System32\\*", "C:/Windows/System32/*")).toBe(true)
  })
})
