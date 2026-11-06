import { describe, expect, test } from "bun:test"
import { spawnSync } from "child_process"
import fs from "fs/promises"
import path from "path"
import { batchCommand } from "@opencode/core/plugin/provider/claude-agent/claude/io"
import { tmpdir } from "../../../../fixture/tmpdir"

const shim = "C:\\npm\\claude.cmd"

describe("Claude batch command", () => {
  test("quotes the launcher and every argument, then wraps the line for cmd.exe", () => {
    expect(batchCommand(shim, ["--model", "opus"])).toBe('"C:\\npm\\claude.cmd ^^^"--model^^^" ^^^"opus^^^""')
  })

  test("keeps spaces inside a path in one argument", () => {
    const launcher = "C:\\Program Files\\npm\\claude.cmd"
    expect(batchCommand(launcher, ["--version"])).toBe('"C:\\Program^ Files\\npm\\claude.cmd ^^^"--version^^^""')
  })

  test("escapes a quote the way CommandLineToArgvW reads it back", () => {
    expect(batchCommand(shim, ['say "hi"'])).toBe('"C:\\npm\\claude.cmd ^^^"say^^^ \\^^^"hi\\^^^"^^^""')
  })

  test("doubles trailing backslashes so they stay literal before the closing quote", () => {
    expect(batchCommand(shim, ["C:\\temp\\"])).toBe('"C:\\npm\\claude.cmd ^^^"C:\\temp\\\\^^^""')
  })

  test("escapes cmd.exe metacharacters so a batch launcher keeps them literal", () => {
    expect(batchCommand(shim, ["a&b", "%PATH%"])).toBe('"C:\\npm\\claude.cmd ^^^"a^^^&b^^^" ^^^"^^^%PATH^^^%^^^""')
  })

  test.skipIf(process.platform !== "win32")("round-trips arguments through a real batch launcher", async () => {
    await using dir = await tmpdir()
    const folder = path.join(dir.path, "with space")
    const launcher = path.join(folder, "claude.cmd")
    await fs.mkdir(folder)
    await fs.writeFile(launcher, '@echo off\r\nbun "%~dp0argv.js" %*\r\n')
    await fs.writeFile(path.join(folder, "argv.js"), "console.log(JSON.stringify(process.argv.slice(2)))\n")

    const args = [
      "--model",
      "opus",
      "--mcp-config",
      JSON.stringify({
        mcpServers: {
          "a b": {
            command: "C:\\Program Files\\x y\\run.cmd",
            args: [
              "--flag",
              'say "hi"',
              "C:\\temp\\",
              "a&b",
              "x|y",
              "a<b",
              "a>b",
              "^caret",
              "%PATH%",
              "100%",
              "bang!here",
              "q?*",
              "semi;colon",
            ],
          },
        },
      }),
    ]
    const result = spawnSync("cmd.exe", ["/d", "/s", "/c", batchCommand(launcher, args)], {
      windowsVerbatimArguments: true,
      encoding: "utf8",
    })

    expect(result.stderr).toBe("")
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual(args)
  })
})
