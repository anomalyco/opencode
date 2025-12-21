import { describe, it, expect } from "bun:test"

describe("Index.ts TUI corruption", () => {
  it("should NOT have console.error in error handler (corrupts TUI)", async () => {
    const indexSource = await Bun.file(new URL("../index.ts", import.meta.url).pathname).text()

    // Check if console.error exists (outside of comments)
    // The problematic line is: console.error(e)
    const hasConsoleError = indexSource.includes("console.error(e)")

    expect(hasConsoleError).toBe(false) // FAILS - proving the bug exists
  })
})
