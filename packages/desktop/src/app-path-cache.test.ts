import { describe, expect, test } from "bun:test"
import { createAppPathCache, forgetAppPath, getAppPath, rememberAppPath } from "./app-path-cache"

describe("app path cache", () => {
  test("bounds remembered app paths without retaining evicted entries", () => {
    const cache = createAppPathCache()

    for (const index of Array.from({ length: 33 }, (_, index) => index)) {
      rememberAppPath(cache, `app-${index}`, `C:\\Tools\\app-${index}.exe`)
    }

    expect(cache.keys).toHaveLength(32)
    expect(cache.values).toHaveLength(32)
    expect(getAppPath(cache, "app-0")).toBeUndefined()
    expect(getAppPath(cache, "app-1")).toBe("C:\\Tools\\app-1.exe")
    expect(getAppPath(cache, "app-32")).toBe("C:\\Tools\\app-32.exe")
  })

  test("forgets stale app paths", () => {
    const cache = createAppPathCache()

    rememberAppPath(cache, "code", "C:\\Tools\\Code.exe")
    forgetAppPath(cache, "code")

    expect(getAppPath(cache, "code")).toBeUndefined()
  })
})
