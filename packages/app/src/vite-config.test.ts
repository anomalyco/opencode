import { describe, expect, test } from "bun:test"

describe("vite config", () => {
  test("uses a relative base for subpath-safe asset output", async () => {
    const source = await Bun.file(new URL("../vite.config.ts", import.meta.url)).text()

    expect(source).toContain('base: "./"')
  })
})
