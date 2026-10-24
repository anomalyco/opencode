import { expect, test } from "bun:test"
import { Ignore } from "@opencode/core/filesystem/ignore"
// @ts-ignore
import { createWrapper } from "@parcel/watcher/wrapper.js"

async function compile(patterns: readonly string[]) {
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
  await watcher.subscribe("/tmp/project", () => {}, { ignore: [...patterns] })
  return ignoreGlobs.map((source) => new RegExp(source))
}

test("parcel patterns ignore built-in folders at any depth", async () => {
  const patterns = await compile(Ignore.PATTERNS)

  for (const path of [
    "nested/node_modules",
    "nested/node_modules/package/index.js",
    "nested/.git",
    "nested/.git/HEAD",
    "nested/dist",
    "nested/dist/index.js",
    "nested/.venv/lib/python3.12/site-packages/pip/__init__.py",
    "nested/__pycache__/module.pyc",
    "nested/.mypy_cache/data.json",
    "coverage/lcov-report/index.html",
    "nested/build/output.js",
    "nested/target/debug/binary",
  ]) {
    expect(patterns.some((pattern) => pattern.test(path))).toBe(true)
  }
  expect(patterns.some((pattern) => pattern.test("nested/src/index.ts"))).toBe(false)
})

test("parcel patterns keep watching folders that legitimately hold source", async () => {
  const patterns = await compile(Ignore.PATTERNS)

  for (const path of [
    "packages/desktop/src/index.ts",
    "packages/app/bin/cli.js",
    "vendor/modules.txt",
    "nested/tmp/scratch.ts",
  ]) {
    expect(patterns.some((pattern) => pattern.test(path))).toBe(false)
  }
})
