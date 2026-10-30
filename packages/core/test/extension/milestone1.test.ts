import { describe, expect, it } from "bun:test"
import { Effect, Layer } from "effect"
import path from "path"
import os from "os"
import fs from "fs"
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { ExtensionDetector } from "../../src/extension/detector.js"
import { AdapterGenerator } from "../../src/extension/adapter-generator.js"
import { ExtensionRegistry } from "../../src/extension/registry.js"
import { ExtensionSecurity } from "../../src/extension/security.js"
import { UniversalMcpManager } from "../../src/extension/mcp/manager.js"
import type { Extension } from "@opencode/schema/extension"

const tmpGlobal = fs.mkdtempSync(path.join(os.tmpdir(), "uece-global-test-"))
const testFsLayer = Layer.provideMerge(FSUtil.layer, NodeFileSystem.layer)
const testGlobalLayer = Global.layerWith({ config: tmpGlobal, home: path.join(tmpGlobal, "home") })
const fullLayer = Layer.merge(testFsLayer, testGlobalLayer)

describe("Universal Agent Extension Compatibility Engine (Milestone 1)", () => {
  it("decomposes a multi-component package into separate CIRs preserving relationships", async () => {
    const pkgDir = fs.mkdtempSync(path.join(os.tmpdir(), "multi-pkg-"))

    // 1. Skill component
    fs.mkdirSync(path.join(pkgDir, "skills", "code-reviewer"), { recursive: true })
    fs.writeFileSync(
      path.join(pkgDir, "skills", "code-reviewer", "SKILL.md"),
      "---\nname: Code Reviewer\ndescription: AI code review\n---\nReview instructions",
    )

    // 2. Rules component
    fs.writeFileSync(path.join(pkgDir, "CLAUDE.md"), "# Project Instructions\nAlways write tests.")

    // 3. MCP component
    fs.writeFileSync(
      path.join(pkgDir, "claude_desktop_config.json"),
      JSON.stringify({
        mcpServers: {
          testServer: {
            command: "node",
            args: ["server.js"],
          },
        },
      }),
    )

    const source: Extension.Source = {
      type: "local",
      location: pkgDir,
    }

    const result = await Effect.runPromise(
      ExtensionDetector.decomposePackage(pkgDir, source, "project").pipe(Effect.provide(fullLayer)),
    )

    expect(result).toBeDefined()
    expect(result.components.length).toBeGreaterThanOrEqual(3)

    // Verify all components have a shared packageId
    const firstPackageId = result.components[0]?.packageId
    expect(firstPackageId).toBeDefined()
    for (const comp of result.components) {
      expect(comp.packageId).toBe(firstPackageId)
    }

    // Verify component categories
    const categories = result.components.map((c) => c.category)
    expect(categories).toContain("skill")
    expect(categories).toContain("rule")
    expect(categories).toContain("mcp")

    fs.rmSync(pkgDir, { recursive: true, force: true })
  })

  it("handles native-compatible imports without adapters", async () => {
    const testCir: Extension.CIR = {
      id: "native-skill-1",
      name: "Native Skill",
      version: "1.0.0",
      category: "skill",
      originPlatform: "opencode",
      source: { type: "local", location: "/tmp/native-skill" },
      scope: "project",
      status: "installed",
      enabled: true,
      executionMode: "native",
      permissions: {},
      tools: [{ name: "read" }, { name: "write" }],
      metadata: {},
    }

    const proposal = await Effect.runPromise(
      AdapterGenerator.inspectAndPropose(testCir).pipe(Effect.provide(fullLayer)),
    )

    expect(proposal.compatible).toBe(true)
    expect(proposal.compatibilityScore).toBe(100)
    expect(proposal.nativeCapabilities).toContain("read")
    expect(proposal.nativeCapabilities).toContain("write")
    expect(proposal.mappableCapabilities.length).toBe(0)
    expect(proposal.missingCapabilities.length).toBe(0)
    expect(proposal.validationStatus).toBe("passed")
  })

  it("performs format conversion and maps foreign capabilities in adapter proposal", async () => {
    const foreignCir: Extension.CIR = {
      id: "foreign-vscode-ext",
      name: "VSCode Helper",
      version: "2.1.0",
      category: "plugin",
      originPlatform: "cursor",
      source: { type: "local", location: "/tmp/vscode-ext" },
      scope: "project",
      status: "installed",
      enabled: true,
      executionMode: "adapted",
      permissions: {},
      tools: [{ name: "vscode.workspace.fs.readFile" }, { name: "codex.tools.bash" }],
      metadata: {},
    }

    const proposal = await Effect.runPromise(
      AdapterGenerator.inspectAndPropose(foreignCir).pipe(Effect.provide(fullLayer)),
    )

    expect(proposal.compatible).toBe(true)
    expect(proposal.compatibilityScore).toBe(100)
    expect(proposal.mappableCapabilities.length).toBe(2)
    expect(proposal.mappableCapabilities.some((m) => m.targetApi === "read")).toBe(true)
    expect(proposal.mappableCapabilities.some((m) => m.targetApi === "shell")).toBe(true)
    expect(proposal.generatedAdapterCode).toBeDefined()
    expect(proposal.generatedAdapterCode).toContain("createShim")
    expect(proposal.generatedTests).toBeDefined()
    expect(proposal.validationStatus).toBe("passed")
    expect(proposal.requiresApproval).toBe(true)
  })

  it("explicitly reports missing and unsupported capabilities without fabricating compatibility", async () => {
    const incompatibleCir: Extension.CIR = {
      id: "incompatible-cloud-ext",
      name: "Proprietary Cloud Agent",
      version: "1.0.0",
      category: "plugin",
      originPlatform: "custom",
      source: { type: "local", location: "/tmp/cloud-ext" },
      scope: "project",
      status: "installed",
      enabled: true,
      executionMode: "adapted",
      permissions: {},
      tools: [{ name: "read" }, { name: "unsupported_proprietary_hypervisor_call" }],
      metadata: {},
    }

    const proposal = await Effect.runPromise(
      AdapterGenerator.inspectAndPropose(incompatibleCir).pipe(Effect.provide(fullLayer)),
    )

    expect(proposal.compatible).toBe(false)
    expect(proposal.compatibilityScore).toBe(50) // 1 out of 2 supported
    expect(proposal.missingCapabilities).toContain("unsupported_proprietary_hypervisor_call")
    expect(proposal.validationStatus).toBe("failed")
    expect(proposal.validationErrors).toBeDefined()
    expect(proposal.validationErrors?.[0]).toContain("unsupported_proprietary_hypervisor_call")
  })

  it("converts Claude Desktop and Cursor MCP configurations into OpenCode format", () => {
    const claudeJson = {
      mcpServers: {
        github: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"],
          env: { GITHUB_TOKEN: "tok_123" },
        },
      },
    }

    const imported = UniversalMcpManager.importClaudeDesktopConfig(JSON.stringify(claudeJson))
    expect(imported.github).toBeDefined()
    expect(imported.github?.type).toBe("local")
    if (imported.github?.type === "local") {
      expect(imported.github.command).toEqual(["npx", "-y", "@modelcontextprotocol/server-github"])
      expect(imported.github.environment).toHaveProperty("GITHUB_TOKEN", "tok_123")
    }

    const cursorJson = {
      mcpServers: {
        memory: {
          command: "node",
          args: ["memory.js"],
        },
      },
    }

    const cursorImported = UniversalMcpManager.importCursorConfig(JSON.stringify(cursorJson))
    expect(cursorImported.memory).toBeDefined()
    expect(cursorImported.memory?.type).toBe("local")
  })

  it("manages extension versions, updates, history, and rollbacks in the registry", async () => {
    const regLayer = Layer.provideMerge(ExtensionRegistry.layer, fullLayer)

    await Effect.runPromise(
      Effect.gen(function* () {
        const reg = yield* ExtensionRegistry.Service

        // 1. Initial install v1.0.0
        const v1: Extension.CIR = {
          id: "test-reg-ext",
          name: "Test Ext",
          version: "1.0.0",
          category: "skill",
          originPlatform: "opencode",
          source: { type: "local", location: "/tmp/ext" },
          scope: "global",
          status: "enabled",
          enabled: true,
          permissions: {},
          metadata: {},
        }
        yield* reg.register(v1)

        const initial = yield* reg.get("test-reg-ext")
        expect(initial?.version).toBe("1.0.0")

        // 2. Update to v1.1.0
        const v11: Extension.CIR = {
          ...v1,
          version: "1.1.0",
        }
        yield* reg.register(v11)

        const updated = yield* reg.get("test-reg-ext")
        expect(updated?.version).toBe("1.1.0")

        // 3. Rollback to v1.0.0
        const rbRecord = yield* reg.rollback("test-reg-ext", "1.0.0")
        expect(rbRecord).toBeDefined()
        expect(rbRecord?.previousVersion).toBe("1.1.0")
        expect(rbRecord?.targetVersion).toBe("1.0.0")

        const rolledBack = yield* reg.get("test-reg-ext")
        expect(rolledBack?.version).toBe("1.0.0")

        // 4. Verify history log
        const history = yield* reg.getHistory("test-reg-ext")
        expect(history.length).toBeGreaterThanOrEqual(3)
        expect(history.some((h) => h.action === "install")).toBe(true)
        expect(history.some((h) => h.action === "update")).toBe(true)
        expect(history.some((h) => h.action === "rollback")).toBe(true)

        // 5. Clean up
        yield* reg.remove("test-reg-ext")
        const afterRemove = yield* reg.get("test-reg-ext")
        expect(afterRemove).toBeUndefined()
      }).pipe(Effect.provide(regLayer)),
    )
  })

  it("enforces permission security and detects dangerous patterns", () => {
    const maliciousCode = `
      import child_process from "child_process"
      const token = "-----BEGIN RSA PRIVATE KEY-----"
      eval("process.exit(1)")
    `

    const findings = ExtensionSecurity.scanContent(maliciousCode, "index.js")
    expect(findings.length).toBeGreaterThanOrEqual(3)
    expect(findings.some((f) => f.code === "SEC-COMMAND-EXEC")).toBe(true)
    expect(findings.some((f) => f.code === "SEC-SECRET-TOKEN")).toBe(true)
    expect(findings.some((f) => f.code === "SEC-DANGEROUS-EVAL")).toBe(true)

    // Path traversal check
    expect(ExtensionSecurity.isPathSafe("../etc/passwd")).toBe(false)
    expect(ExtensionSecurity.isPathSafe("..\\windows\\system32")).toBe(false)
    expect(ExtensionSecurity.isPathSafe("/etc/passwd")).toBe(false)
    expect(ExtensionSecurity.isPathSafe("src/index.ts")).toBe(true)
  })
})
