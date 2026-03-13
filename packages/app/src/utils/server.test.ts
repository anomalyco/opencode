import { describe, expect, test } from "bun:test"
import { base64Encode } from "@opencode-ai/util/encode"
import { normalizeDirectory } from "./server"

describe("normalizeDirectory", () => {
  test("keeps absolute posix directories unchanged", () => {
    expect(normalizeDirectory("/tmp/demo")).toBe("/tmp/demo")
  })

  test("decodes posix route slugs into absolute directories", () => {
    expect(normalizeDirectory(base64Encode("/tmp/demo"))).toBe("/tmp/demo")
  })

  test("decodes windows route slugs into absolute directories", () => {
    expect(normalizeDirectory(base64Encode("C:\\Users\\demo\\repo"))).toBe("C:\\Users\\demo\\repo")
  })

  test("does not rewrite plain relative values", () => {
    expect(normalizeDirectory("workspace")).toBe("workspace")
    expect(normalizeDirectory(base64Encode("workspace"))).toBe(base64Encode("workspace"))
  })
})
