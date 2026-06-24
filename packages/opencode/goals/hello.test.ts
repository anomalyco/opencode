import { describe, it, expect } from "bun:test"

describe("Goal: hello world", () => {
  it("exports a helloWorld function that returns greeting", async () => {
    const mod = await import("@/evolution-rsi/hello")
    expect(mod.helloWorld).toBeDefined()
    expect(typeof mod.helloWorld).toBe("function")
    const result = mod.helloWorld()
    expect(result).toContain("Hello")
  })
})
