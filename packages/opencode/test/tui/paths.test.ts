import { describe, expect, test } from "bun:test"
import path from "path"
import { normalizePathFromDirectory } from "../../src/cli/cmd/tui/util/paths"

describe("normalizePathFromDirectory", () => {
  test("returns relative path for absolute input", () => {
    const directory = "/tmp/opencode-test"
    const input = path.join(directory, "src", "index.ts")
    expect(normalizePathFromDirectory(input, directory)).toBe(path.join("src", "index.ts"))
  })

  test("keeps relative input unchanged", () => {
    const directory = "/tmp/opencode-test"
    const input = "src/index.ts"
    expect(normalizePathFromDirectory(input, directory)).toBe(input)
  })

  test("returns dot when input equals base directory", () => {
    const directory = "/tmp/opencode-test"
    expect(normalizePathFromDirectory(directory, directory)).toBe(".")
  })

  test("returns empty string for empty input", () => {
    const directory = "/tmp/opencode-test"
    expect(normalizePathFromDirectory("", directory)).toBe("")
  })
})
