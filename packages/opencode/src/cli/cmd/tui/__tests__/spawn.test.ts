import { describe, it, expect } from "bun:test"

describe("Spawn.ts TUI corruption", () => {
  it("should NOT use stderr: inherit (child errors corrupt TUI)", async () => {
    const spawnSource = await Bun.file(new URL("../spawn.ts", import.meta.url).pathname).text()

    // Check if stderr: "inherit" exists
    // This lets child process stderr corrupt the parent TUI
    const hasStderrInherit = spawnSource.includes('stderr: "inherit"')

    expect(hasStderrInherit).toBe(false) // FAILS - proving the bug exists
  })
})
