import { describe, test, expect, spyOn, beforeEach, afterEach } from "bun:test"
import { safePath } from "../path"
import { Config } from "../../config/config"

// Config.get requires AsyncLocalStorage context not present in test env.
// Mock it for all tests; config-driven tests override within each case.
let spy: ReturnType<typeof spyOn<typeof Config, "get">>
beforeEach(() => {
  spy = spyOn(Config, "get").mockResolvedValue({} as any)
})
afterEach(() => spy?.mockRestore())

describe("Path Traversal Prevention", () => {
  test("allows valid path within base", async () => {
    expect(await safePath("/home/user/project", "src/index.ts")).not.toBeNull()
  })
  test("blocks path traversal", async () => {
    expect(await safePath("/home/user/project", "../../etc/passwd")).toBeNull()
  })
  test("blocks NUL byte injection", async () => {
    expect(await safePath("/home/user/project", "file\x00.ts")).toBeNull()
  })
})

describe("config-driven behavior", () => {
  test("SEC-07: traversal check runs by default when security key absent", async () => {
    spy.mockResolvedValue({} as any)
    expect(await safePath("/home/user/project", "../../etc/passwd")).toBeNull()
  })

  test("SEC-03: bypasses traversal check when pathTraversal.enabled = false", async () => {
    spy.mockResolvedValue({
      security: { pathTraversal: { enabled: false } },
    } as any)
    const result = await safePath("/home/user/project", "../../etc/passwd")
    expect(result).not.toBeNull()
  })

  test("SEC-03: blocks traversal when pathTraversal.enabled = true", async () => {
    spy.mockResolvedValue({
      security: { pathTraversal: { enabled: true } },
    } as any)
    expect(await safePath("/home/user/project", "../../etc/passwd")).toBeNull()
  })
})
