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

describe("Advanced Project Operations", () => {
  it.effect("creates, renames, archives, restores, and safely deletes projects", () =>
    Effect.gen(function* () {
      const ops = yield* ProjectOperations.Service
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wm-proj-"))

      // 1. Create project
      const created = yield* ops.create({
        name: "My Universal Project",
        directory: AbsolutePath.make(tmp),
        commands: { start: "bun test" },
      })

      expect(created.name).toBe("My Universal Project")
      expect(created.canonical).toBe(AbsolutePath.make(tmp))

      // 2. Rename project
      const renamed = yield* ops.rename(created.id, "Renamed Universal Project")
      expect(renamed.name).toBe("Renamed Universal Project")

      // 3. Archive project
      const archived = yield* ops.archive(created.id)
      expect(archived).toBe(true)

      // 4. Restore project
      const restored = yield* ops.restore(created.id)
      expect(restored).toBe(true)

      // 5. Search projects
      const searchResults = yield* ops.search("Universal")
      expect(searchResults.length).toBeGreaterThan(0)
      expect(searchResults[0]?.id).toBe(created.id)

      // 6. Safe delete: ensures physical directory is PRESERVED on disk!
      const deleted = yield* ops.delete({
        projectID: created.id,
        deletePhysicalFiles: false,
      })
      expect(deleted).toBe(true)
      expect(fs.existsSync(tmp)).toBe(true) // Physical directory still exists!

      // Cleanup
      fs.rmSync(tmp, { recursive: true, force: true })
    }),
  )
})

describe("Dynamic Multi-Folder Workspaces", () => {
  it.effect("attaches multiple independent folders and generates unified tree", () =>
    Effect.gen(function* () {
      const ops = yield* ProjectOperations.Service
      const mfw = yield* MultiFolderWorkspace.Service

      const rootA = fs.mkdtempSync(path.join(os.tmpdir(), "mfw-rootA-"))
      const rootB = fs.mkdtempSync(path.join(os.tmpdir(), "mfw-rootB-"))

      // Create files in both roots
      fs.writeFileSync(path.join(rootA, "package.json"), "{}")
      fs.writeFileSync(path.join(rootB, "service.go"), "package main")

      // Create Project
      const project = yield* ops.create({
        name: "Multi-Root App",
        directory: AbsolutePath.make(rootA),
      })

      // Add secondary root
      const added = yield* mfw.addFolder({
        projectID: project.id,
        directory: AbsolutePath.make(rootB),
        name: "Backend Service",
      })

      expect(added.name).toBe("Backend Service")
      expect(added.isPrimary).toBe(false)

      // List all folders
      const folders = yield* mfw.listFolders(project.id)
      expect(folders.length).toBe(2)

      // Verify unified tree
      const tree = yield* mfw.getUnifiedTree(project.id)
      expect(tree.length).toBe(2)
      expect(tree.some((n) => n.name === "Backend Service")).toBe(true)

      // Relink rootB to new path
      const rootBRelink = fs.mkdtempSync(path.join(os.tmpdir(), "mfw-rootB-relink-"))
      const relinked = yield* mfw.relinkFolder({
        projectID: project.id,
        oldDirectory: AbsolutePath.make(rootB),
        newDirectory: AbsolutePath.make(rootBRelink),
      })
      expect(relinked.path).toBe(AbsolutePath.make(rootBRelink))

      // Remove secondary folder safely (files must remain on disk!)
      const removed = yield* mfw.removeFolder({
        projectID: project.id,
        directory: AbsolutePath.make(rootBRelink),
      })
      expect(removed).toBe(true)
      expect(fs.existsSync(rootBRelink)).toBe(true)

      // Cleanup
      fs.rmSync(rootA, { recursive: true, force: true })
      fs.rmSync(rootB, { recursive: true, force: true })
      fs.rmSync(rootBRelink, { recursive: true, force: true })
    }),
  )
})

describe("Project Attachments Engine", () => {
  it.effect("attaches, indexes, reads and searches project attachments", () =>
    Effect.gen(function* () {
      const ops = yield* ProjectOperations.Service
      const att = yield* ProjectAttachments.Service

      const tmpProj = fs.mkdtempSync(path.join(os.tmpdir(), "att-proj-"))
      const tmpDoc = path.join(tmpProj, "spec.md")
      fs.writeFileSync(tmpDoc, "# System Architecture\nThis document describes the API and storage details.")

      const project = yield* ops.create({
        name: "Attachment Project",
        directory: AbsolutePath.make(tmpProj),
      })

      // Add attachment
      const added = yield* att.add({
        projectID: project.id,
        name: "spec.md",
        filePath: tmpDoc,
        mimeType: "text/markdown",
      })

      expect(added.name).toBe("spec.md")
      expect(added.category).toBe("document")
      expect(added.indexed).toBe(true)
      expect(added.extractedSummary).toContain("System Architecture")

      // Read content
      const content = yield* att.readContent(project.id, added.id)
      expect(content).toContain("System Architecture")

      // Search attachment
      const searchRes = yield* att.search(project.id, "Architecture")
      expect(searchRes.length).toBe(1)
      expect(searchRes[0]?.id).toBe(added.id)

      // Remove attachment
      const removed = yield* att.remove(project.id, added.id)
      expect(removed).toBe(true)

      fs.rmSync(tmpProj, { recursive: true, force: true })
    }),
  )
})

describe("Persistent Multi-Conversation Manager", () => {
  it.effect("creates, lists, renames, archives, and deletes independent conversations", () =>
    Effect.gen(function* () {
      const ops = yield* ProjectOperations.Service
      const conv = yield* ProjectConversations.Service

      const tmpProj = fs.mkdtempSync(path.join(os.tmpdir(), "conv-proj-"))
      const project = yield* ops.create({
        name: "Conversation Project",
        directory: AbsolutePath.make(tmpProj),
      })

      // Create conversation 1
      const c1 = yield* conv.create(project.id, "Refactoring discussion")
      expect(c1.title).toBe("Refactoring discussion")
      expect(c1.status).toBe("active")

      // Create conversation 2
      const c2 = yield* conv.create(project.id, "Bug investigation")
      expect(c2.title).toBe("Bug investigation")

      // List active conversations
      const list = yield* conv.list(project.id, false)
      expect(list.length).toBe(2)

      // Rename conversation 1
      const renamed = yield* conv.rename(c1.sessionID, "Refactoring planning")
      expect(renamed).toBe(true)

      // Archive conversation 2
      const archived = yield* conv.archive(c2.sessionID)
      expect(archived).toBe(true)

      const activeOnly = yield* conv.list(project.id, false)
      expect(activeOnly.length).toBe(1)
      expect(activeOnly[0]?.sessionID).toBe(c1.sessionID)

      // Restore conversation 2
      const restored = yield* conv.restore(c2.sessionID)
      expect(restored).toBe(true)

      // Delete conversation 1
      const deleted = yield* conv.delete(c1.sessionID)
      expect(deleted).toBe(true)

      const finalList = yield* conv.list(project.id, true)
      expect(finalList.length).toBe(1)
      expect(finalList[0]?.sessionID).toBe(c2.sessionID)

      fs.rmSync(tmpProj, { recursive: true, force: true })
    }),
  )
})
