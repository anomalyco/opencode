import { describe, expect, test } from "bun:test"
import { dirname, join } from "node:path"
import { APP_PATH_CACHE_LIMIT } from "../app-path-cache"
import { getWindowsFallbackSearchDirs } from "./apps"

describe("Windows app path resolution", () => {
  test("deduplicates fallback search directories from stale resolver output", () => {
    const paths = Array.from({ length: APP_PATH_CACHE_LIMIT }, (_, index) =>
      join("root", "Tools", "bin", `Missing-${index}.exe`),
    )
    const dirs = getWindowsFallbackSearchDirs(paths)
    const bin = dirname(paths[0])
    const tools = dirname(bin)
    const root = dirname(tools)

    expect(dirs).toEqual([bin, tools, root])
  })

  test("bounds fallback search directories from scattered stale resolver output", () => {
    const dirs = getWindowsFallbackSearchDirs(
      Array.from({ length: APP_PATH_CACHE_LIMIT + 1 }, (_, index) =>
        join("root", `Tools-${index}`, "bin", "Missing.exe"),
      ),
    )

    expect(dirs).toHaveLength(APP_PATH_CACHE_LIMIT)
    expect(new Set(dirs).size).toBe(APP_PATH_CACHE_LIMIT)
  })
})
