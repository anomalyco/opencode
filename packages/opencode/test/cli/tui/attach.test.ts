import { describe, expect, test } from "bun:test"
import yargs from "yargs"
import { AttachCommand } from "../../../src/cli/cmd/attach"

describe("tui attach", () => {
  test("loads the TUI integration lazily", async () => {
    const source = await Bun.file(new URL("../../../src/cli/cmd/attach.ts", import.meta.url)).text()

    expect(source).toContain('await import("../tui/layer")')
    expect(source).toMatch(/await import\(["']@\/plugin\/tui\/runtime["']\)/)
    expect(source).not.toContain('import("./app")')
  })

  test("accepts mini input options", async () => {
    const args = await yargs([])
      .command({ ...AttachCommand, handler: () => {} })
      .exitProcess(false)
      .parse([
        "attach",
        "http://127.0.0.1:4096",
        "--mini",
        "--model",
        "test/model",
        "--agent",
        "plan",
        "--prompt",
        "hello",
      ])

    expect(args.model).toBe("test/model")
    expect(args.agent).toBe("plan")
    expect(args.prompt).toBe("hello")
  })
})
