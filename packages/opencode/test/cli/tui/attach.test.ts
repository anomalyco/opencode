import { describe, expect, test } from "bun:test"

describe("tui attach", () => {
  test("loads the public TUI API and legacy hosts lazily", async () => {
    const source = await Bun.file(new URL("../../../src/cli/cmd/tui/attach.ts", import.meta.url)).text()

    expect(source).toContain('await import("@opencode-ai/tui")')
    expect(source).toContain('await import("./host")')
    expect(source).toContain('await import("./plugin/runtime")')
    expect(source).not.toContain('import("./app")')
  })
})
