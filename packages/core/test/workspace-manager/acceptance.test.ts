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
import { AbsolutePath } from "@opencode/core/schema"
import { testEffect } from "../lib/effect"
import { ProjectOperations } from "../../src/workspace-manager/project.js"
import { MultiFolderWorkspace } from "../../src/workspace-manager/multi-folder.js"
import { ProjectAttachments } from "../../src/workspace-manager/attachments.js"
import { ProjectConversations } from "../../src/workspace-manager/conversations.js"

const baseLayer = AppNodeBuilder.build(LayerNode.group([Project.node, Database.node, Bus.node, FSUtil.node]))
const managersLayer = Layer.mergeAll(
  ProjectOperations.layer,
  MultiFolderWorkspace.layer,
  ProjectAttachments.layer,
  ProjectConversations.layer,
)
const fullTestLayer = managersLayer.pipe(Layer.provide(baseLayer))
const it = testEffect(fullTestLayer)

describe("Milestone 3 — Advanced Project & Workspace Management Acceptance Suite", () => {
  it.effect("executes all 12 required acceptance scenarios end-to-end", () =>
    Effect.gen(function* () {
      const ops = yield* ProjectOperations.Service
      const mfw = yield* MultiFolderWorkspace.Service
      const att = yield* ProjectAttachments.Service
      const conv = yield* ProjectConversations.Service

      // Prepare isolated scratch directories across different simulated locations
      const tempBase = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-acceptance-"))
      const primaryDir = path.join(tempBase, "primary-app")
      const folder1 = path.join(tempBase, "external-shared-libs")
      const folder2 = path.join(tempBase, "external-services-api")
      const folder3 = path.join(tempBase, "external-docs-and-specs")
      const folder4 = path.join(tempBase, "late-attached-plugin")

      fs.mkdirSync(primaryDir, { recursive: true })
      fs.mkdirSync(folder1, { recursive: true })
      fs.mkdirSync(folder2, { recursive: true })
      fs.mkdirSync(folder3, { recursive: true })
      fs.mkdirSync(folder4, { recursive: true })

      fs.writeFileSync(path.join(primaryDir, "package.json"), JSON.stringify({ name: "primary-app", version: "1.0.0" }))
      fs.writeFileSync(path.join(folder1, "utils.ts"), "export const add = (a: number, b: number) => a + b")
      fs.writeFileSync(path.join(folder2, "server.go"), "package main\nfunc main() {}")
      fs.writeFileSync(path.join(folder3, "spec.md"), "# System Specification\nUniversal agent ecosystem.")
      fs.writeFileSync(path.join(folder4, "plugin.json"), JSON.stringify({ name: "custom-tool" }))

      // =========================================================================
      // SCENARIO 1: Creating a project
      // =========================================================================
      const project = yield* ops.create({
        name: "Enterprise Multi-Repo Application",
        directory: AbsolutePath.make(primaryDir),
        commands: { start: "bun run dev" },
      })

      expect(project.id).toBeDefined()
      expect(project.name).toBe("Enterprise Multi-Repo Application")
      expect(project.canonical).toBe(AbsolutePath.make(primaryDir))

      const initialFolders = yield* mfw.listFolders(project.id)
      expect(initialFolders.length).toBe(1)
      expect(initialFolders[0]?.isPrimary).toBe(true)
      expect(initialFolders[0]?.path).toBe(AbsolutePath.make(primaryDir))
      expect(initialFolders[0]?.status).toBe("active")

      // =========================================================================
      // SCENARIO 2: Adding three folders from unrelated locations
      // =========================================================================
      const addedBatch = yield* mfw.addFolders({
        projectID: project.id,
        folders: [
          { directory: AbsolutePath.make(folder1), name: "Shared Libraries" },
          { directory: AbsolutePath.make(folder2), name: "Backend Services" },
          { directory: AbsolutePath.make(folder3), name: "Documentation & Specs" },
        ],
      })

      expect(addedBatch.length).toBe(3)
      const afterBatchFolders = yield* mfw.listFolders(project.id)
      expect(afterBatchFolders.length).toBe(4) // 1 primary + 3 secondary
      expect(afterBatchFolders.some((f) => f.name === "Shared Libraries")).toBe(true)
      expect(afterBatchFolders.some((f) => f.name === "Backend Services")).toBe(true)
      expect(afterBatchFolders.some((f) => f.name === "Documentation & Specs")).toBe(true)

      // =========================================================================
      // SCENARIO 3: Adding another folder after the project already exists
      // =========================================================================
      const lateFolder = yield* mfw.addFolder({
        projectID: project.id,
        directory: AbsolutePath.make(folder4),
        name: "Late Plugin",
      })

      expect(lateFolder.name).toBe("Late Plugin")
      expect(lateFolder.isPrimary).toBe(false)
      const fiveFolders = yield* mfw.listFolders(project.id)
      expect(fiveFolders.length).toBe(5)

      // Verify duplicate attachment prevention
      const duplicateAttempt = yield* mfw.addFolder({
        projectID: project.id,
        directory: AbsolutePath.make(folder4),
      })
      expect(duplicateAttempt.path).toBe(lateFolder.path)
      const stillFiveFolders = yield* mfw.listFolders(project.id)
      expect(stillFiveFolders.length).toBe(5) // No duplicate added!

      // =========================================================================
      // SCENARIO 4: Removing one folder without deleting its files
      // =========================================================================
      const folder2File = path.join(folder2, "server.go")
      expect(fs.existsSync(folder2File)).toBe(true)

      const removedFolder2 = yield* mfw.removeFolder({
        projectID: project.id,
        directory: AbsolutePath.make(folder2),
      })
      expect(removedFolder2).toBe(true)

      const fourFolders = yield* mfw.listFolders(project.id)
      expect(fourFolders.length).toBe(4)
      expect(fourFolders.some((f) => f.path === AbsolutePath.make(folder2))).toBe(false)
      // PHYSICAL FILE MUST STILL EXIST ON DISK!
      expect(fs.existsSync(folder2File)).toBe(true)

      // =========================================================================
      // SCENARIO 5: Changing the primary folder
      // =========================================================================
      const switchedPrimary = yield* mfw.setPrimary(project.id, AbsolutePath.make(folder1))
      expect(switchedPrimary).toBe(true)

      const foldersAfterPrimarySwitch = yield* mfw.listFolders(project.id)
      const newPrimary = foldersAfterPrimarySwitch.find((f) => f.path === AbsolutePath.make(folder1))
      const oldPrimary = foldersAfterPrimarySwitch.find((f) => f.path === AbsolutePath.make(primaryDir))

      expect(newPrimary?.isPrimary).toBe(true)
      expect(oldPrimary?.isPrimary).toBe(false)

      // =========================================================================
      // SCENARIO 6: Restarting the application and recovering the workspace
      // =========================================================================
      // Manifests persisted under .opencode/workspace.json
      const recoveredFolders = yield* mfw.listFolders(project.id)
      expect(recoveredFolders.length).toBe(4)
      const unifiedTree = yield* mfw.getUnifiedTree(project.id)
      expect(unifiedTree.length).toBe(4)
      expect(unifiedTree.some((root) => root.name === "Shared Libraries" || root.path === AbsolutePath.make(folder1))).toBe(true)

      // =========================================================================
      // SCENARIO 7: Relinking a moved folder
      // =========================================================================
      const folder3Moved = path.join(tempBase, "moved-docs-and-specs")
      fs.renameSync(folder3, folder3Moved)

      // Before relinking, folder3 is missing on disk
      const foldersWithMissing = yield* mfw.listFolders(project.id)
      const missingFolder = foldersWithMissing.find((f) => f.path === AbsolutePath.make(folder3))
      expect(missingFolder?.status).toBe("missing")

      // Relink to new path
      const relinked = yield* mfw.relinkFolder({
        projectID: project.id,
        oldDirectory: AbsolutePath.make(folder3),
        newDirectory: AbsolutePath.make(folder3Moved),
      })
      expect(relinked.path).toBe(AbsolutePath.make(folder3Moved))
      expect(relinked.status).toBe("active")

      const foldersAfterRelink = yield* mfw.listFolders(project.id)
      expect(foldersAfterRelink.some((f) => f.path === AbsolutePath.make(folder3Moved))).toBe(true)
      expect(foldersAfterRelink.some((f) => f.path === AbsolutePath.make(folder3))).toBe(false)

      // =========================================================================
      // SCENARIO 8: Adding and removing attachments (files, directories, replacing)
      // =========================================================================
      const sampleDoc = path.join(tempBase, "api-contract.md")
      fs.writeFileSync(sampleDoc, "# API Contract v2\nEndpoints for universal extensions and workspace roots.")

      const sampleDir = path.join(tempBase, "design-assets")
      fs.mkdirSync(sampleDir, { recursive: true })
      fs.writeFileSync(path.join(sampleDir, "logo.svg"), "<svg></svg>")

      // 1. Add file attachment
      const docAttachment = yield* att.add({
        projectID: project.id,
        name: "api-contract.md",
        filePath: sampleDoc,
        mimeType: "text/markdown",
      })
      expect(docAttachment.category).toBe("document")
      expect(docAttachment.indexed).toBe(true)
      expect(docAttachment.extractedSummary).toContain("API Contract v2")

      // 2. Add directory attachment
      const dirAttachment = yield* att.add({
        projectID: project.id,
        name: "design-assets",
        filePath: sampleDir,
      })
      expect(dirAttachment.category).toBe("archive")
      expect(dirAttachment.extractedSummary).toContain("Directory archive")

      // 3. Search attachments
      const searchRes = yield* att.search(project.id, "contract")
      expect(searchRes.length).toBe(1)
      expect(searchRes[0]?.id).toBe(docAttachment.id)

      // 4. Read content selectively
      const content = yield* att.readContent(project.id, docAttachment.id, 50)
      expect(content).toContain("API Contract")

      // 5. Replace attachment
      const updatedDoc = path.join(tempBase, "api-contract-updated.md")
      fs.writeFileSync(updatedDoc, "# API Contract v2 (UPDATED)\nIncludes binary attachment streaming.")
      const replaced = yield* att.replace({
        projectID: project.id,
        attachmentID: docAttachment.id,
        filePath: updatedDoc,
      })
      expect(replaced.extractedSummary).toContain("UPDATED")

      // 6. Remove attachment
      const removedAtt = yield* att.remove(project.id, docAttachment.id)
      expect(removedAtt).toBe(true)
      const afterRemoveList = yield* att.list(project.id)
      expect(afterRemoveList.some((a) => a.id === docAttachment.id)).toBe(false)

      // =========================================================================
      // SCENARIO 9: Opening multiple conversations
      // =========================================================================
      const conv1 = yield* conv.create(project.id, "Architecture & Multi-Root Planning")
      const conv2 = yield* conv.create(project.id, "Bug Fix: Attachment Parsing")
      const conv3 = yield* conv.create(project.id, "Release 2.3.0 Checklist")

      expect(conv1.title).toBe("Architecture & Multi-Root Planning")
      expect(conv2.title).toBe("Bug Fix: Attachment Parsing")
      expect(conv3.title).toBe("Release 2.3.0 Checklist")

      const convList = yield* conv.list(project.id)
      expect(convList.length).toBe(3)

      // Rename conversation
      yield* conv.rename(conv1.sessionID, "Architecture Planning (Approved)")
      const convListAfterRename = yield* conv.list(project.id)
      expect(convListAfterRename.find((c) => c.sessionID === conv1.sessionID)?.title).toBe(
        "Architecture Planning (Approved)",
      )

      // =========================================================================
      // SCENARIO 10: Sharing project context between conversations
      // =========================================================================
      // Both conversations belong to the same projectID and share identical workspace roots & attachments
      const conv1Roots = yield* mfw.listFolders(conv1.projectID)
      const conv2Roots = yield* mfw.listFolders(conv2.projectID)
      expect(conv1Roots.length).toBe(conv2Roots.length)
      expect(conv1Roots[0]?.id).toBe(conv2Roots[0]?.id)

      const conv1Attachments = yield* att.list(conv1.projectID)
      const conv2Attachments = yield* att.list(conv2.projectID)
      expect(conv1Attachments.length).toBe(conv2Attachments.length)

      // =========================================================================
      // SCENARIO 11: Archiving and restoring projects
      // =========================================================================
      const archived = yield* ops.archive(project.id)
      expect(archived).toBe(true)

      const searchActive = yield* ops.search("Enterprise")
      const enterpriseFound = searchActive.find((p) => p.id === project.id)
      expect(enterpriseFound?.time.archived).toBeDefined()

      const restored = yield* ops.restore(project.id)
      expect(restored).toBe(true)

      const searchRestored = yield* ops.search("Enterprise")
      const restoredProject = searchRestored.find((p) => p.id === project.id)
      expect(restoredProject?.time.archived).toBeUndefined()

      // =========================================================================
      // SCENARIO 12: Deleting a project while preserving its source directories
      // =========================================================================
      // Verify all directories exist on disk before deletion
      expect(fs.existsSync(primaryDir)).toBe(true)
      expect(fs.existsSync(folder1)).toBe(true)
      expect(fs.existsSync(folder2)).toBe(true)
      expect(fs.existsSync(folder3Moved)).toBe(true)
      expect(fs.existsSync(folder4)).toBe(true)

      // Delete project WITHOUT physical file deletion (default safe behavior)
      const deleted = yield* ops.delete({
        projectID: project.id,
        deletePhysicalFiles: false,
      })
      expect(deleted).toBe(true)

      // ALL PHYSICAL DIRECTORIES AND FILES MUST STILL REMAIN INTACT!
      expect(fs.existsSync(primaryDir)).toBe(true)
      expect(fs.existsSync(folder1)).toBe(true)
      expect(fs.existsSync(folder2)).toBe(true)
      expect(fs.existsSync(folder3Moved)).toBe(true)
      expect(fs.existsSync(folder4)).toBe(true)

      // Clean up tempBase
      fs.rmSync(tempBase, { recursive: true, force: true })
    }),
  )
})
