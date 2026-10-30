import { describe, expect, it } from "bun:test"
import { Effect, Layer } from "effect"
import path from "path"
import os from "os"
import fs from "fs"
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem"
import { FSUtil } from "@opencode/util/fs-util"
import { ExtensionSecurity } from "../../src/extension/security.js"

const testLayer = Layer.provideMerge(FSUtil.layer, NodeFileSystem.layer)

describe("ExtensionSecurity", () => {
  it("rejects path traversal attempts", () => {
    expect(ExtensionSecurity.isPathSafe("../outside")).toBe(false)
    expect(ExtensionSecurity.isPathSafe("foo/../../bar")).toBe(false)
    expect(ExtensionSecurity.isPathSafe("/root/absolute")).toBe(false)
    expect(ExtensionSecurity.isPathSafe("safe/relative/file.txt")).toBe(true)
  })

  it("detects destructive command patterns", () => {
    const findings = ExtensionSecurity.scanContent("rm -rf /")
    expect(findings.length).toBeGreaterThan(0)
    expect(findings[0]?.severity).toBe("critical")
    expect(findings[0]?.code).toBe("SEC-CMD-FORMAT")
  })

  it("detects exposed secret patterns", () => {
    const findings = ExtensionSecurity.scanContent("const token = 'ghp_123456789012345678901234567890123456'")
    expect(findings.length).toBeGreaterThan(0)
    expect(findings[0]?.severity).toBe("error")
    expect(findings[0]?.code).toBe("SEC-SECRET-TOKEN")
  })

  it("passes safe directory and reports clean status", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sec-test-"))
    fs.writeFileSync(path.join(tmp, "SKILL.md"), "# Safe skill\n\nThis is a safe skill documentation.")

    const report = await Effect.runPromise(
      ExtensionSecurity.scanDirectory(tmp).pipe(Effect.provide(testLayer)),
    )

    expect(report.safe).toBe(true)
    expect(report.riskLevel).toBe("low")
    expect(report.findings.length).toBe(0)
    fs.rmSync(tmp, { recursive: true, force: true })
  })
})
