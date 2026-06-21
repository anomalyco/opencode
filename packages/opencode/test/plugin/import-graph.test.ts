import { describe, expect, test } from "bun:test"

describe("plugin import graph", () => {
  test("keeps session runtime out of the static plugin graph", async () => {
    const source = await Bun.file(new URL("../../src/plugin/index.ts", import.meta.url)).text()

    expect(source).not.toMatch(/import\s+\{\s*Session\s*\}\s+from\s+["']@\/session\/session["']/)
    expect(source).toContain('import("@/session/session")')
  })

  test("imports app runtime without provider/plugin TDZ", async () => {
    const runtime = await import("../../src/effect/app-runtime")

    expect(runtime.AppRuntime).toBeDefined()
  })
})
