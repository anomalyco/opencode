import { describe, expect, it } from "bun:test"
import { Effect, Layer } from "effect"
import path from "path"
import os from "os"
import fs from "fs"
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem"
import { FSUtil } from "@opencode/util/fs-util"
import { ExtensionDetector } from "../../src/extension/detector.js"

const testLayer = Layer.provideMerge(FSUtil.layer, NodeFileSystem.layer)

describe("ExtensionDetector", () => {
  it("detects CLAUDE.md file as claude rule", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ext-det-"))
    const claudeFile = path.join(tmp, "CLAUDE.md")
    fs.writeFileSync(claudeFile, "# Claude instructions")

    const result = await Effect.runPromise(
      ExtensionDetector.detect(claudeFile).pipe(Effect.provide(testLayer)),
    )

    expect(result.platform).toBe("claude")
    expect(result.category).toBe("rule")
    expect(result.confidence).toBe(1.0)
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it("detects Cursor .cursorrules and .mdc files as cursor rules", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ext-det-"))
    const cursorFile = path.join(tmp, ".cursorrules")
    fs.writeFileSync(cursorFile, "Custom cursor instructions")

    const result = await Effect.runPromise(
      ExtensionDetector.detect(cursorFile).pipe(Effect.provide(testLayer)),
    )

    expect(result.platform).toBe("cursor")
    expect(result.category).toBe("rule")
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it("detects Claude Desktop MCP configuration file", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ext-det-"))
    const mcpFile = path.join(tmp, "claude_desktop_config.json")
    fs.writeFileSync(mcpFile, JSON.stringify({ mcpServers: {} }))

    const result = await Effect.runPromise(
      ExtensionDetector.detect(mcpFile).pipe(Effect.provide(testLayer)),
    )

    expect(result.platform).toBe("claude")
    expect(result.category).toBe("mcp")
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it("detects Antigravity multi-directory skill package", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ext-det-"))
    fs.writeFileSync(path.join(tmp, "SKILL.md"), "---\nname: my-skill\n---\n")
    fs.mkdirSync(path.join(tmp, "scripts"))
    fs.writeFileSync(path.join(tmp, "scripts", "run.py"), "print('hello')")

    const result = await Effect.runPromise(
      ExtensionDetector.detect(tmp).pipe(Effect.provide(testLayer)),
    )

    expect(result.platform).toBe("antigravity")
    expect(result.category).toBe("skill")
    fs.rmSync(tmp, { recursive: true, force: true })
  })
})
