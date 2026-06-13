import { test, expect } from "bun:test"
import { tmpdir } from "node:os"
import path from "node:path"
import { assertLocalSource, resolveInside, SkillSafetyError, fileCache, memoize } from "./index"

test("assertLocalSource rejects remote URLs", () => {
  expect(() => assertLocalSource("https://evil.example/data.json")).toThrow(SkillSafetyError)
  expect(() => assertLocalSource("http://169.254.169.254/latest")).toThrow(SkillSafetyError)
})

test("assertLocalSource allows local paths and file://", () => {
  expect(assertLocalSource("./data/report.json")).toBe("./data/report.json")
  expect(assertLocalSource("file:///tmp/x.json")).toBe("file:///tmp/x.json")
})

test("resolveInside blocks path traversal", () => {
  expect(() => resolveInside("/srv/out", "../../etc/passwd")).toThrow(SkillSafetyError)
  expect(() => resolveInside("/srv/out", "/etc/passwd")).toThrow(SkillSafetyError)
  expect(resolveInside("/srv/out", "report.md")).toBe(path.resolve("/srv/out/report.md"))
})

test("memoize caches by input hash", async () => {
  const dir = path.join(tmpdir(), `skill-cache-${Date.now()}`)
  const cache = fileCache(dir)
  let calls = 0
  const produce = async () => {
    calls++
    return "rendered"
  }
  expect(await memoize(cache, "abc", produce)).toBe("rendered")
  expect(await memoize(cache, "abc", produce)).toBe("rendered")
  expect(calls).toBe(1)
})
