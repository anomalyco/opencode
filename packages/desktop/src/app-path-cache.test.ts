import { describe, expect, test } from "bun:test"
import { APP_PATH_CACHE_LIMIT, createAppPathCache, forgetAppPath, getAppPath, rememberAppPath } from "./app-path-cache"

describe("app path cache", () => {
  test("bounds remembered app paths without retaining evicted entries", () => {
    const cache = createAppPathCache()

    for (const index of Array.from({ length: APP_PATH_CACHE_LIMIT + 1 }, (_, index) => index)) {
      rememberAppPath(cache, `app-${index}`, `C:\\Tools\\app-${index}.exe`)
    }

    expect(cache.keys).toHaveLength(APP_PATH_CACHE_LIMIT)
    expect(cache.values).toHaveLength(APP_PATH_CACHE_LIMIT)
    expect(getAppPath(cache, "app-0")).toBeUndefined()
    expect(getAppPath(cache, "app-1")).toBe("C:\\Tools\\app-1.exe")
    expect(getAppPath(cache, `app-${APP_PATH_CACHE_LIMIT}`)).toBe(`C:\\Tools\\app-${APP_PATH_CACHE_LIMIT}.exe`)
  })

  test("forgets stale app paths", () => {
    const cache = createAppPathCache()

    rememberAppPath(cache, "code", "C:\\Tools\\Code.exe")
    forgetAppPath(cache, "code")

    expect(getAppPath(cache, "code")).toBeUndefined()
  })
})
