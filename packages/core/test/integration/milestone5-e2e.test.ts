import { describe, expect } from "bun:test"
import fs from "fs"
import path from "path"
import os from "os"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { Project } from "@opencode/core/project"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { AbsolutePath } from "@opencode/core/schema"
import { testEffect } from "../lib/effect"

import { ProjectOperations } from "../../src/workspace-manager/project.js"
import { MultiFolderWorkspace } from "../../src/workspace-manager/multi-folder.js"
import { ProjectAttachments } from "../../src/workspace-manager/attachments.js"
import { ProjectConversations } from "../../src/workspace-manager/conversations.js"
import { ConfigMigration } from "../../src/workspace-manager/config-migration.js"

import { ExtensionDetector } from "../../src/extension/detector.js"
import { ExtensionRegistry } from "../../src/extension/registry.js"
import { ExtensionSecurity } from "../../src/extension/security.js"
import { SkillAdapter } from "../../src/extension/skills/adapter.js"
import { UniversalMcpManager } from "../../src/extension/mcp/manager.js"

const baseLayer = AppNodeBuilder.build(
  LayerNode.group([
    Project.node,
    Database.node,
    Bus.node,
    FSUtil.node,
    Global.node,
  ]),
)

const managersLayer = Layer.mergeAll(
  ProjectOperations.layer,
  MultiFolderWorkspace.layer,
  ProjectAttachments.layer,
  ProjectConversations.layer,
  ExtensionRegistry.layer,
  ConfigMigration.layer,
)

const fullTestLayer = managersLayer.pipe(Layer.provideMerge(baseLayer))
const it = testEffect(fullTestLayer)

describe("Milestone 5 — Production E2E Workflow Verification", () => {
  it.effect("executes complete lifecycle: project creation, multi-folder, extension import, agent execution context, and data migration", () =>
    Effect.gen(function* () {
      const ops = yield* ProjectOperations.Service
      const mfw = yield* MultiFolderWorkspace.Service
      const att = yield* ProjectAttachments.Service
      const conv = yield* ProjectConversations.Service
      const registry = yield* ExtensionRegistry.Service
      const migrator = yield* ConfigMigration.Service

      const tempBase = fs.mkdtempSync(path.join(os.tmpdir(), "m5-e2e-"))
      const primaryDir = path.join(tempBase, "primary-service")
      const externalSharedDir = path.join(tempBase, "external-shared-utils")
      const foreignExtDir = path.join(tempBase, "antigravity-code-review-bundle")

      fs.mkdirSync(primaryDir, { recursive: true })
      fs.mkdirSync(externalSharedDir, { recursive: true })
      fs.mkdirSync(foreignExtDir, { recursive: true })

      fs.writeFileSync(path.join(primaryDir, "server.ts"), "export const server = () => 'running'")
      fs.writeFileSync(path.join(externalSharedDir, "math.ts"), "export const add = (a: number, b: number) => a + b")

      // 1. Create Project
      const project = yield* ops.create({
        name: "Universal Agent Production Workspace",
        directory: AbsolutePath.make(primaryDir),
        commands: { start: "bun run dev" },
      })
      expect(project.id).toBeDefined()
      expect(project.name).toBe("Universal Agent Production Workspace")

      // 2. Attach Secondary Folder from different location
      const attachedFolder = yield* mfw.addFolder({
        projectID: project.id,
        directory: AbsolutePath.make(externalSharedDir),
        name: "Shared Utilities",
      })
      expect(attachedFolder.status).toBe("active")

      // Verify unified tree
      const unifiedTree = yield* mfw.getUnifiedTree(project.id)
      expect(unifiedTree.length).toBe(2)
      expect(unifiedTree[0].isRootFolder).toBe(true)
      expect(unifiedTree[1].name).toBe("Shared Utilities")

      // 3. Create foreign Antigravity extension package with SKILL.md and .cursorrules
      fs.writeFileSync(
        path.join(foreignExtDir, "SKILL.md"),
        `---\nname: Automated Code Auditor\ndescription: Audits code for security defects\n---\n# Code Auditor Instructions\nAlways inspect for unescaped inputs.`,
      )
      fs.writeFileSync(
        path.join(foreignExtDir, ".cursorrules"),
        `// Security Enforcement Rules\nall code must use strict TypeScript.`,
      )

      // 4. Ingest and detect foreign extension
      const detected = yield* ExtensionDetector.detect(foreignExtDir)
      expect(detected.category).toBeDefined()

      // 5. Decompose package into separate CIR components
      const source = { type: "local" as const, location: foreignExtDir }
      const decomposed = yield* ExtensionDetector.decomposePackage(foreignExtDir, source, "project")
      expect(decomposed.components.length).toBeGreaterThanOrEqual(1)

      // 6. Security Audit the extension before registration
      const securityReport = yield* ExtensionSecurity.scanDirectory(foreignExtDir)
      expect(securityReport.safe).toBe(true)
      expect(securityReport.riskLevel).toBe("low")

      // 7. Register the skill into the project extension registry
      const skillCir = yield* SkillAdapter.inspect(foreignExtDir)
      expect(skillCir).toBeDefined()
      const registeredSkill = {
        ...skillCir!,
        id: "antigravity.code-auditor",
        name: skillCir?.name ?? "Automated Code Auditor",
        version: skillCir?.version ?? "1.0.0",
        category: "skill" as const,
        scope: "project" as const,
        status: "enabled" as const,
        enabled: true,
      }
      yield* registry.register(registeredSkill)

      const activeExtensions = yield* registry.list("project")
      expect(activeExtensions.some((ext) => ext.id === "antigravity.code-auditor")).toBe(true)

      // 8. Test MCP Configuration Integration & Connection Diagnostics
      const mcpTestResult = yield* UniversalMcpManager.testServer("sqlite-local", {
        type: "local",
        command: ["bun", "-v"],
      })
      expect(mcpTestResult.details.executableFound).toBe(true)

      // 9. Attach and index Project Specification Attachment
      const specPath = path.join(tempBase, "ARCHITECTURE_SPEC.md")
      fs.writeFileSync(specPath, "# Architectural Specification\nBackend services must be asynchronous Effect generators.")
      const attachment = yield* att.add({
        projectID: project.id,
        name: "ARCHITECTURE_SPEC.md",
        filePath: specPath,
        mimeType: "text/markdown",
      })
      expect(attachment.indexed).toBe(true)
      expect(attachment.extractedSummary).toContain("Architectural Specification")

      // 10. Agent Execution Context Verification in Session
      const session = yield* conv.create(project.id, "Production Agent Run #1")
      expect(session.sessionID).toBeDefined()

      // Verify agent has access to all attached workspace folders
      const agentFolders = yield* mfw.listFolders(session.projectID)
      expect(agentFolders.length).toBe(2)

      // Verify agent has access to project attachments
      const agentAttachments = yield* att.list(session.projectID)
      expect(agentAttachments.length).toBe(1)
      expect(agentAttachments[0].name).toBe("ARCHITECTURE_SPEC.md")

      // Verify agent has access to enabled skill instructions
      const agentSkills = yield* registry.list("project")
      const codeAuditor = agentSkills.find((s) => s.id === "antigravity.code-auditor")
      expect(codeAuditor).toBeDefined()
      expect(codeAuditor?.enabled).toBe(true)

      // 11. Test Config Migration and Fork Isolation
      const enhancedPaths = migrator.getEnhancedPaths()
      expect(enhancedPaths.isForkIsolated).toBe(true)
      const persistence = yield* migrator.verifyPersistence(project.id)
      expect(persistence.projectSettingsPersisted).toBe(true)
      expect(persistence.dataDirectoriesIsolated).toBe(true)

      // 12. Cleanup session and verify non-destructive project deletion
      yield* conv.delete(session.sessionID)
      yield* ops.delete({ projectID: project.id, deletePhysicalFiles: false }) // false = preserve physical files
      expect(fs.existsSync(primaryDir)).toBe(true)
      expect(fs.existsSync(externalSharedDir)).toBe(true)

      fs.rmSync(tempBase, { recursive: true, force: true })
    }),
  )
})
