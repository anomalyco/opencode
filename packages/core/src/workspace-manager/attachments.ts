export * as ProjectAttachments from "./attachments.js"

import path from "path"
import { Context, Effect, Layer } from "effect"
import { FSUtil } from "@opencode/util/fs-util"
import { Hash } from "@opencode/util/hash"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Project } from "@opencode/schema/project"
import { ProjectWorkspace } from "@opencode/schema/project-workspace"
import { Database } from "../database/database.js"
import { ProjectTable } from "../project/sql.js"
import { eq } from "drizzle-orm"

const MAX_ATTACHMENT_SIZE = 50 * 1024 * 1024 // 50 MB limit

export function categorizeMime(filename: string, mime?: string): ProjectWorkspace.AttachmentCategory {
  const ext = path.extname(filename).toLowerCase()
  if ([".ts", ".js", ".tsx", ".jsx", ".py", ".rs", ".go", ".c", ".cpp", ".java", ".json", ".yaml", ".yml"].includes(ext)) {
    return "source"
  }
  if ([".md", ".txt", ".rtf", ".pdf", ".docx", ".doc"].includes(ext)) {
    return "document"
  }
  if ([".csv", ".tsv", ".xlsx", ".xls", ".parquet"].includes(ext)) {
    return "data"
  }
  if ([".png", ".jpg", ".jpeg", ".svg", ".gif", ".webp"].includes(ext)) {
    return "image"
  }
  if ([".zip", ".tar", ".gz", ".tgz", ".7z"].includes(ext)) {
    return "archive"
  }
  return "other"
}

export function extractSummary(content: string, category: ProjectWorkspace.AttachmentCategory): string {
  if (category === "data" || category === "source" || category === "document") {
    const lines = content.split("\n")
    const preview = lines.slice(0, 30).join("\n")
    return `Lines: ${lines.length}. Preview:\n${preview}`
  }
  return `Binary or media resource (${content.length} characters).`
}

export interface Interface {
  readonly list: (projectID: Project.ID) => Effect.Effect<ReadonlyArray<ProjectWorkspace.ProjectAttachment>>
  readonly get: (projectID: Project.ID, attachmentID: string) => Effect.Effect<ProjectWorkspace.ProjectAttachment | undefined>
  readonly add: (input: ProjectWorkspace.AddAttachmentInput) => Effect.Effect<ProjectWorkspace.ProjectAttachment, Error>
  readonly replace: (input: ProjectWorkspace.ReplaceAttachmentInput) => Effect.Effect<ProjectWorkspace.ProjectAttachment, Error>
  readonly remove: (projectID: Project.ID, attachmentID: string) => Effect.Effect<boolean>
  readonly readContent: (projectID: Project.ID, attachmentID: string, maxBytes?: number) => Effect.Effect<string | undefined>
  readonly search: (projectID: Project.ID, query: string) => Effect.Effect<ReadonlyArray<ProjectWorkspace.ProjectAttachment>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ProjectAttachments") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const fs = yield* FSUtil.Service

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

    const getAttachmentsManifestPath = (projectCanonical: string) =>
      path.join(projectCanonical, ".opencode", "attachments", "index.json")

    const readManifest = Effect.fnUntraced(function* (projectCanonical: string) {
      const manifestFile = getAttachmentsManifestPath(projectCanonical)
      const exists = yield* fs.exists(manifestFile).pipe(Effect.orElseSucceed(() => false))
      if (!exists) return []
      const raw = yield* fs.readFileStringSafe(manifestFile).pipe(Effect.orElseSucceed(() => undefined))
      if (!raw) return []
      try {
        const parsed = JSON.parse(raw)
        return Array.isArray(parsed) ? (parsed as ProjectWorkspace.ProjectAttachment[]) : []
      } catch {
        return []
      }
    })

    const writeManifest = (projectCanonical: string, items: ReadonlyArray<ProjectWorkspace.ProjectAttachment>) =>
      Effect.gen(function* () {
        const manifestFile = getAttachmentsManifestPath(projectCanonical)
        yield* fs.ensureDir(path.dirname(manifestFile)).pipe(Effect.ignore)
        yield* fs.writeFileString(manifestFile, JSON.stringify(items, null, 2)).pipe(Effect.ignore)
      })

    return Service.of({
      list: Effect.fn("ProjectAttachments.list")(function* (projectID) {
        const canonical = yield* getCanonical(projectID)
        if (!canonical) return []
        return yield* readManifest(canonical)
      }),

      get: Effect.fn("ProjectAttachments.get")(function* (projectID, attachmentID) {
        const canonical = yield* getCanonical(projectID)
        if (!canonical) return undefined
        const items = yield* readManifest(canonical)
        return items.find((i) => i.id === attachmentID)
      }),

      add: Effect.fn("ProjectAttachments.add")(function* (input) {
        const canonical = yield* getCanonical(input.projectID)
        if (!canonical) {
          return yield* Effect.fail(new Error(`Project not found: ${input.projectID}`))
        }

        const sourceFile = input.filePath
        const stat = yield* fs.stat(sourceFile).pipe(Effect.orElseSucceed(() => undefined))
        if (!stat) {
          return yield* Effect.fail(new Error(`Attachment file not found: ${sourceFile}`))
        }

        const isDir = stat.type === "Directory"
        let sizeNumber = Number(stat.size)
        const id = Hash.fast(`attachment:${input.name}:${Date.now()}`)
        const category = isDir ? ("archive" as const) : categorizeMime(input.name, input.mimeType)
        const storageDir = path.join(canonical, ".opencode", "attachments", "files")
        yield* fs.ensureDir(storageDir).pipe(Effect.ignore)

        const destFile = path.join(storageDir, `${id}_${path.basename(input.name)}`)
        let summary: string | undefined

        if (isDir) {
          yield* fs.copy(sourceFile, destFile).pipe(Effect.orDie)
          const entries = yield* fs.readDirectoryEntries(sourceFile).pipe(Effect.orElseSucceed(() => []))
          summary = `Directory archive containing ${entries.length} items. Entries: ${entries.slice(0, 10).map((e) => e.name).join(", ")}`
          sizeNumber = entries.length * 1024
        } else {
          if (sizeNumber > MAX_ATTACHMENT_SIZE) {
            return yield* Effect.fail(new Error(`Attachment exceeds maximum size of 50 MB`))
          }

          const bytes = yield* fs.readFile(sourceFile).pipe(Effect.orDie)
          yield* fs.writeWithDirs(destFile, bytes).pipe(Effect.orDie)

          if (category === "document" || category === "source" || category === "data") {
            const text = yield* fs.readFileStringSafe(destFile).pipe(Effect.orElseSucceed(() => undefined))
            if (text) {
              summary = extractSummary(text, category)
            }
          }
        }

        const attachment: ProjectWorkspace.ProjectAttachment = {
          id,
          projectID: input.projectID,
          name: input.name,
          originalPath: sourceFile,
          storagePath: destFile,
          mimeType: isDir ? "application/x-directory" : (input.mimeType || "application/octet-stream"),
          category,
          size: sizeNumber,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          indexed: summary !== undefined,
          extractedSummary: summary,
          metadata: {
            extension: isDir ? "dir" : path.extname(input.name),
            isDirectory: isDir,
          },
        }

        const items = yield* readManifest(canonical)
        const updated = [...items, attachment]
        yield* writeManifest(canonical, updated)

        return attachment
      }),

      replace: Effect.fn("ProjectAttachments.replace")(function* (input) {
        const canonical = yield* getCanonical(input.projectID)
        if (!canonical) {
          return yield* Effect.fail(new Error(`Project not found: ${input.projectID}`))
        }

        const items = yield* readManifest(canonical)
        const existing = items.find((i) => i.id === input.attachmentID)
        if (!existing) {
          return yield* Effect.fail(new Error(`Attachment not found: ${input.attachmentID}`))
        }

        const stat = yield* fs.stat(input.filePath).pipe(Effect.orElseSucceed(() => undefined))
        if (!stat) {
          return yield* Effect.fail(new Error(`Replacement file not found: ${input.filePath}`))
        }

        const bytes = yield* fs.readFile(input.filePath).pipe(Effect.orDie)
        yield* fs.writeWithDirs(existing.storagePath, bytes).pipe(Effect.orDie)

        let summary: string | undefined
        if (existing.category === "document" || existing.category === "source" || existing.category === "data") {
          const text = yield* fs.readFileStringSafe(existing.storagePath).pipe(Effect.orElseSucceed(() => undefined))
          if (text) {
            summary = extractSummary(text, existing.category)
          }
        }

        const updatedAttachment: ProjectWorkspace.ProjectAttachment = {
          ...existing,
          size: Number(stat.size),
          updatedAt: Date.now(),
          indexed: summary !== undefined,
          extractedSummary: summary,
        }

        const updated = items.map((i) => (i.id === input.attachmentID ? updatedAttachment : i))
        yield* writeManifest(canonical, updated)

        return updatedAttachment
      }),

      remove: Effect.fn("ProjectAttachments.remove")(function* (projectID, attachmentID) {
        const canonical = yield* getCanonical(projectID)
        if (!canonical) return false

        const items = yield* readManifest(canonical)
        const target = items.find((i) => i.id === attachmentID)
        if (!target) return false

        yield* fs.remove(target.storagePath).pipe(Effect.ignore)

        const filtered = items.filter((i) => i.id !== attachmentID)
        yield* writeManifest(canonical, filtered)

        return true
      }),

      readContent: Effect.fn("ProjectAttachments.readContent")(function* (projectID, attachmentID, maxBytes = 100_000) {
        const canonical = yield* getCanonical(projectID)
        if (!canonical) return undefined

        const items = yield* readManifest(canonical)
        const target = items.find((i) => i.id === attachmentID)
        if (!target) return undefined

        const content = yield* fs.readFileStringSafe(target.storagePath).pipe(Effect.orElseSucceed(() => undefined))
        if (!content) return undefined

        if (content.length > maxBytes) {
          return content.slice(0, maxBytes) + `\n\n... [Content truncated at ${maxBytes} bytes] ...`
        }

        return content
      }),

      search: Effect.fn("ProjectAttachments.search")(function* (projectID, query) {
        const canonical = yield* getCanonical(projectID)
        if (!canonical) return []

        const items = yield* readManifest(canonical)
        const lower = query.toLowerCase()

        return items.filter((item) => {
          if (item.name.toLowerCase().includes(lower)) return true
          if (item.extractedSummary && item.extractedSummary.toLowerCase().includes(lower)) return true
          return false
        })
      }),
    })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [Database.node, FSUtil.node],
})
