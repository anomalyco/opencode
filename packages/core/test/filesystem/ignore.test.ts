import { expect, test } from "bun:test"
import { Ignore } from "@opencode-ai/core/filesystem/ignore"
// @ts-ignore
import { createWrapper } from "@parcel/watcher/wrapper"

test("parcel patterns ignore built-in folders at any depth", async () => {
  let ignoreGlobs: string[] = []
  const watcher = createWrapper({
    subscribe: async (
      _directory: string,
      _callback: (...args: unknown[]) => unknown,
      options: { ignoreGlobs?: string[] },
    ) => {
      ignoreGlobs = options.ignoreGlobs ?? []
    },
  })
  await watcher.subscribe("/tmp/project", () => {}, { ignore: Ignore.PATTERNS })
  const patterns = ignoreGlobs.map((source) => new RegExp(source))

  for (const path of [
    "nested/node_modules",
    "nested/node_modules/package/index.js",
    "nested/.git",
    "nested/.git/HEAD",
    "nested/.jj",
    "nested/.jj/repo/op_store/operations/current",
    "nested/dist",
    "nested/dist/index.js",
  ]) {
    expect(patterns.some((pattern) => pattern.test(path))).toBe(true)
  }
  expect(patterns.some((pattern) => pattern.test("nested/src/index.ts"))).toBe(false)
})
