import { describe, expect, test } from "bun:test"
import path from "path"
import { tmpdir } from "../lib/tmp"
import { config, toolset } from "./harness"

describe("grep / glob", () => {
  test("glob lists matching files as absolute paths", async () => {
    await using dir = await tmpdir({ files: { "src/a.ts": "a", "src/b.ts": "b", "readme.md": "r" } })
    const tools = await toolset(config(dir.path))
    const result = await tools.call("glob", { pattern: "**/*.ts" })
    expect(result.text.split("\n").sort()).toEqual([path.join(dir.path, "src/a.ts"), path.join(dir.path, "src/b.ts")])
    expect((await tools.call("glob", { pattern: "*.nothing" })).text).toBe("No files found")
  })

  test("grep groups matches by file with line numbers and honours include", async () => {
    await using dir = await tmpdir({ files: { "a.ts": "const needle = 1\nother\n", "b.md": "needle here\n" } })
    const tools = await toolset(config(dir.path))
    const all = await tools.call("grep", { pattern: "needle" })
    expect(all.text).toStartWith("Found 2 matches")
    expect(all.text).toContain(`${path.join(dir.path, "a.ts")}:\n  Line 1: const needle = 1`)
    const ts = await tools.call("grep", { pattern: "needle", include: "*.ts" })
    expect(ts.text).toStartWith("Found 1 matches")
    expect(ts.text).not.toContain("b.md")
  })

  test("grep outside cwd asks for external_directory (headless: denied)", async () => {
    await using dir = await tmpdir()
    await using outside = await tmpdir({ files: { "x.txt": "needle" } })
    const tools = await toolset(config(dir.path))
    const result = await tools.call("grep", { pattern: "needle", path: outside.path })
    expect(result.status).toBe("denied")
    expect(result.text).toBe(`permission denied: external_directory ${path.join(outside.path, "*")}`)
  })
})
