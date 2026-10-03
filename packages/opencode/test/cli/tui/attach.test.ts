import { describe, expect, test } from "bun:test"

describe("tui attach", () => {
  test("loads the TUI integration lazily", async () => {
    const source = await Bun.file(new URL("../../../src/cli/cmd/attach.ts", import.meta.url)).text()

    expect(source).toContain('await import("../tui/layer")')
    expect(source).toMatch(/await import\(["']@\/plugin\/tui\/runtime["']\)/)
    expect(source).not.toContain('import("./app")')
  })

  test("forwards automatic permission flags", async () => {
    const source = await Bun.file(new URL("../../../src/cli/cmd/attach.ts", import.meta.url)).text()
    const mini = await Bun.file(new URL("../../../src/cli/cmd/run.ts", import.meta.url)).text()

    expect(source).toContain('.option("auto"')
    expect(source).toContain('.option("yolo"')
    expect(source).toContain('.option("dangerously-skip-permissions"')
    expect(source.match(/auto: args\.auto \|\| args\.yolo \|\| args\["dangerously-skip-permissions"\]/g)).toHaveLength(
      2,
    )
    expect(mini).toContain("auto: input.auto ?? false")
  })
})
