export * as MultiFolderWorkspace from "./multi-folder.js"

import path from "path"
import { Context, Effect, Layer } from "effect"
import { eq, and } from "drizzle-orm"
import { FSUtil } from "@opencode/util/fs-util"
import { Hash } from "@opencode/util/hash"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Database } from "../database/database.js"
import { ProjectTable } from "../project/sql.js"
import { WorktreeTable } from "../worktree/sql.js"
import { Project } from "@opencode/schema/project"
import { ProjectWorkspace } from "@opencode/schema/project-workspace"
import { AbsolutePath } from "../schema.js"

export interface Interface {
  readonly listFolders: (projectID: Project.ID) => Effect.Effect<ReadonlyArray<ProjectWorkspace.WorkspaceFolder>>
  readonly addFolder: (input: ProjectWorkspace.AddFolderInput) => Effect.Effect<ProjectWorkspace.WorkspaceFolder, Error>
  readonly addFolders: (input: ProjectWorkspace.AddMultipleFoldersInput) => Effect.Effect<ReadonlyArray<ProjectWorkspace.WorkspaceFolder>, Error>
  readonly removeFolder: (input: ProjectWorkspace.RemoveFolderInput) => Effect.Effect<boolean>
  readonly setPrimary: (projectID: Project.ID, directory: AbsolutePath) => Effect.Effect<boolean>
  readonly relinkFolder: (input: ProjectWorkspace.RelinkFolderInput) => Effect.Effect<ProjectWorkspace.WorkspaceFolder, Error>
  readonly getUnifiedTree: (projectID: Project.ID) => Effect.Effect<ReadonlyArray<UnifiedNode>>
}

export interface UnifiedNode {
  readonly name: string
  readonly path: string
  readonly type: "directory" | "file"
  readonly isRootFolder?: boolean
  readonly status?: ProjectWorkspace.FolderStatus
  readonly children?: ReadonlyArray<UnifiedNode>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/MultiFolderWorkspace") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const fs = yield* FSUtil.Service

    const getProjectConfigDir = (projectCanonical: string) => path.join(projectCanonical, ".opencode")
    const getWorkspaceManifestPath = (projectCanonical: string) =>
      path.join(getProjectConfigDir(projectCanonical), "workspace.json")

    const readManifest = Effect.fnUntraced(function* (projectCanonical: string) {
      const manifestFile = getWorkspaceManifestPath(projectCanonical)
      const exists = yield* fs.exists(manifestFile).pipe(Effect.orElseSucceed(() => false))
      if (!exists) return []
      const raw = yield* fs.readFileStringSafe(manifestFile).pipe(Effect.orElseSucceed(() => undefined))
      if (!raw) return []
      try {
        const parsed = JSON.parse(raw)
        return Array.isArray(parsed) ? (parsed as ProjectWorkspace.WorkspaceFolder[]) : []
      } catch {
        return []
      }
    })

    const writeManifest = (projectCanonical: string, folders: ReadonlyArray<ProjectWorkspace.WorkspaceFolder>) =>
      Effect.gen(function* () {
        const manifestFile = getWorkspaceManifestPath(projectCanonical)
        yield* fs.ensureDir(path.dirname(manifestFile)).pipe(Effect.ignore)
        yield* fs.writeFileString(manifestFile, JSON.stringify(folders, null, 2)).pipe(Effect.ignore)
      })

    const getCanonical = (projectID: Project.ID) =>
      Effect.gen(function* () {
        const project = yield* db
          .select({ worktree: ProjectTable.worktree })
          .from(ProjectTable)
          .where(eq(ProjectTable.id, projectID))
          .get()
          .pipe(Effect.orDie)
        return project ? project.worktree : undefined
      })

    const listFoldersInternal = (projectID: Project.ID) =>
      Effect.gen(function* () {
        const canonical = yield* getCanonical(projectID)
        if (!canonical) return []

        const manifestFolders = yield* readManifest(canonical)

        const dbWorktrees = yield* db
          .select()
          .from(WorktreeTable)
          .where(eq(WorktreeTable.project_id, projectID))
          .all()
          .pipe(Effect.orDie)

        const result: ProjectWorkspace.WorkspaceFolder[] = [...manifestFolders]

        if (!result.some((f) => f.path === canonical)) {
          const exists = yield* fs.existsSafe(canonical)
          result.unshift({
            id: Hash.fast(`folder:${canonical}`),
            projectID,
            path: canonical,
            name: path.basename(canonical) || canonical,
            isPrimary: true,
            status: exists ? "active" : "missing",
            addedAt: Date.now(),
          })
        }

        for (const wt of dbWorktrees) {
          if (!result.some((f) => f.path === wt.directory)) {
            const exists = yield* fs.existsSafe(wt.directory)
            result.push({
              id: Hash.fast(`folder:${wt.directory}`),
              projectID,
              path: wt.directory,
              name: path.basename(wt.directory) || wt.directory,
              isPrimary: wt.directory === canonical,
              status: exists ? "active" : "missing",
              addedAt: wt.time_created,
            })
          }
        }

        const refreshed: ProjectWorkspace.WorkspaceFolder[] = []
        for (const f of result) {
          const exists = yield* fs.existsSafe(f.path)
          refreshed.push({
            ...f,
            status: exists ? "active" : "missing",
          })
        }

        return refreshed
      })

    return Service.of({
      listFolders: Effect.fn("MultiFolderWorkspace.listFolders")(function* (projectID) {
        return yield* listFoldersInternal(projectID)
      }),

      addFolder: Effect.fn("MultiFolderWorkspace.addFolder")(function* (input) {
        const canonical = yield* getCanonical(input.projectID)
        if (!canonical) {
          return yield* Effect.fail(new Error(`Project not found: ${input.projectID}`))
        }

        const resolved = AbsolutePath.make(yield* fs.resolve(input.directory))
        const existingFolders = yield* listFoldersInternal(input.projectID)
        const duplicate = existingFolders.find((f) => f.path === resolved)
        if (duplicate) {
          return duplicate
        }

        const exists = yield* fs.existsSafe(resolved)
        const name = input.name || path.basename(resolved) || resolved
        const driveMatch = resolved.match(/^([A-Za-z]:)/)
        const drive = driveMatch ? driveMatch[1] : undefined

        const folder: ProjectWorkspace.WorkspaceFolder = {
          id: Hash.fast(`folder:${resolved}`),
          projectID: input.projectID,
          path: resolved,
          name,
          isPrimary: input.isPrimary === true,
          drive,
          status: exists ? "active" : "missing",
          addedAt: Date.now(),
        }

        yield* db
          .insert(WorktreeTable)
          .values({
            project_id: input.projectID,
            directory: resolved,
            time_created: folder.addedAt,
          })
          .onConflictDoNothing()
          .run()
          .pipe(Effect.orDie)

        const filtered = existingFolders.filter((f) => f.path !== resolved)
        filtered.push(folder)
        yield* writeManifest(canonical, filtered)

        return folder
      }),

      addFolders: Effect.fn("MultiFolderWorkspace.addFolders")(function* (input) {
        const added: ProjectWorkspace.WorkspaceFolder[] = []
        for (const item of input.folders) {
          const canonical = yield* getCanonical(input.projectID)
          if (!canonical) {
            return yield* Effect.fail(new Error(`Project not found: ${input.projectID}`))
          }

          const resolved = AbsolutePath.make(yield* fs.resolve(item.directory))
          const existingFolders = yield* listFoldersInternal(input.projectID)
          const duplicate = existingFolders.find((f) => f.path === resolved)
          if (duplicate) {
            added.push(duplicate)
            continue
          }

          const exists = yield* fs.existsSafe(resolved)
          const name = item.name || path.basename(resolved) || resolved
          const driveMatch = resolved.match(/^([A-Za-z]:)/)
          const drive = driveMatch ? driveMatch[1] : undefined

          const folder: ProjectWorkspace.WorkspaceFolder = {
            id: Hash.fast(`folder:${resolved}`),
            projectID: input.projectID,
            path: resolved,
            name,
            isPrimary: false,
            drive,
            status: exists ? "active" : "missing",
            addedAt: Date.now(),
          }

          yield* db
            .insert(WorktreeTable)
            .values({
              project_id: input.projectID,
              directory: resolved,
              time_created: folder.addedAt,
            })
            .onConflictDoNothing()
            .run()
            .pipe(Effect.orDie)

          const filtered = existingFolders.filter((f) => f.path !== resolved)
          filtered.push(folder)
          yield* writeManifest(canonical, filtered)
          added.push(folder)
        }
        return added
      }),

      removeFolder: Effect.fn("MultiFolderWorkspace.removeFolder")(function* (input) {
        const canonical = yield* getCanonical(input.projectID)
        if (!canonical) return false

        const resolved = AbsolutePath.make(yield* fs.resolve(input.directory))

        yield* db
          .delete(WorktreeTable)
          .where(and(eq(WorktreeTable.project_id, input.projectID), eq(WorktreeTable.directory, resolved)))
          .run()
          .pipe(Effect.orDie)

        const folders = yield* listFoldersInternal(input.projectID)
        const updated = folders.filter((f) => f.path !== resolved)
        yield* writeManifest(canonical, updated)

        return true
      }),

      setPrimary: Effect.fn("MultiFolderWorkspace.setPrimary")(function* (projectID, directory) {
        const canonical = yield* getCanonical(projectID)
        if (!canonical) return false

        const resolved = AbsolutePath.make(yield* fs.resolve(directory))

        yield* db
          .update(ProjectTable)
          .set({ worktree: resolved, time_updated: Date.now() })
          .where(eq(ProjectTable.id, projectID))
          .run()
          .pipe(Effect.orDie)

        const folders = yield* listFoldersInternal(projectID)
        const updated = folders.map((f) => ({
          ...f,
          isPrimary: f.path === resolved,
        }))
        yield* writeManifest(resolved, updated)

        return true
      }),

      relinkFolder: Effect.fn("MultiFolderWorkspace.relinkFolder")(function* (input) {
        const canonical = yield* getCanonical(input.projectID)
        if (!canonical) {
          return yield* Effect.fail(new Error(`Project not found: ${input.projectID}`))
        }

        const oldResolved = AbsolutePath.make(yield* fs.resolve(input.oldDirectory))
        const newResolved = AbsolutePath.make(yield* fs.resolve(input.newDirectory))
        const exists = yield* fs.existsSafe(newResolved)

        yield* db
          .delete(WorktreeTable)
          .where(and(eq(WorktreeTable.project_id, input.projectID), eq(WorktreeTable.directory, oldResolved)))
          .run()
          .pipe(Effect.orDie)

        yield* db
          .insert(WorktreeTable)
          .values({
            project_id: input.projectID,
            directory: newResolved,
            time_created: Date.now(),
          })
          .onConflictDoNothing()
          .run()
          .pipe(Effect.orDie)

        const folder: ProjectWorkspace.WorkspaceFolder = {
          id: Hash.fast(`folder:${newResolved}`),
          projectID: input.projectID,
          path: newResolved,
          name: path.basename(newResolved) || newResolved,
          isPrimary: false,
          status: exists ? "active" : "missing",
          addedAt: Date.now(),
        }

        const folders = yield* listFoldersInternal(input.projectID)
        const updated = folders.filter((f) => f.path !== oldResolved && f.path !== newResolved)
        updated.push(folder)
        yield* writeManifest(canonical, updated)

        return folder
      }),

      getUnifiedTree: Effect.fn("MultiFolderWorkspace.getUnifiedTree")(function* (projectID) {
        const folders = yield* listFoldersInternal(projectID)
        const tree: UnifiedNode[] = []

        for (const folder of folders) {
          const exists = yield* fs.existsSafe(folder.path)
          if (!exists) {
            tree.push({
              name: folder.name,
              path: folder.path,
              type: "directory",
              isRootFolder: true,
              status: "missing",
              children: [],
            })
            continue
          }

          const entries = yield* fs.readDirectoryEntries(folder.path).pipe(Effect.orElseSucceed(() => []))
          const children: UnifiedNode[] = entries
            .filter((e) => !e.name.startsWith(".git") && !e.name.startsWith(".opencode"))
            .map((e) => ({
              name: e.name,
              path: path.join(folder.path, e.name),
              type: e.type === "directory" ? "directory" : "file",
            }))

          tree.push({
            name: folder.name,
            path: folder.path,
            type: "directory",
            isRootFolder: true,
            status: "active",
            children,
          })
        }

        return tree
      }),
    })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [Database.node, FSUtil.node],
})
