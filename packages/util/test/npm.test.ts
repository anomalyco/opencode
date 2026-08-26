import { describe, expect, test } from "bun:test"
import { cacheKey, updatePolicy } from "../src/npm.js"

describe("Npm.updatePolicy", () => {
  test.each([
    ["example-plugin", "mutable"],
    ["example-plugin@latest", "mutable"],
    ["example-plugin@next", "mutable"],
    ["example-plugin@^1.2.3", "mutable"],
    ["example-plugin@1.x", "mutable"],
    ["github:example/plugin", "mutable"],
    ["github:example/plugin#main", "mutable"],
    ["git+https://example.com/plugin.git#release", "mutable"],
    ["example-plugin@1.2.3", "pinned"],
    [`github:example/plugin#${"a".repeat(40)}`, "pinned"],
    [`git+https://example.com/plugin.git#${"b".repeat(64)}`, "pinned"],
    ["./plugin.ts", "unsupported"],
    ["file:./plugin.ts", "unsupported"],
  ] as const)("classifies %s as %s", async (spec, expected) => {
    expect(await updatePolicy(spec)).toBe(expected)
  })
})

test("hashes Git specs before using them as global cache paths", async () => {
  const key = await cacheKey("git+https://user:secret@example.com/plugin.git#main")

  expect(key).toMatch(/^git-[a-f0-9]{64}$/)
  expect(key).not.toContain("secret")
})
