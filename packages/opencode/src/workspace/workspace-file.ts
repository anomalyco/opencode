import path from "node:path"
import { Schema } from "effect"

const FolderSchema = Schema.Struct({
  path: Schema.String,
  name: Schema.optional(Schema.String),
})

export const WorkspaceFileSchema = Schema.Struct({
  folders: Schema.Array(FolderSchema),
  settings: Schema.optional(Schema.Unknown),
  extensions: Schema.optional(Schema.Unknown),
  launch: Schema.optional(Schema.Unknown),
})

export type WorkspaceFolder = Schema.Schema.Type<typeof FolderSchema>
export type WorkspaceFile = Schema.Schema.Type<typeof WorkspaceFileSchema>

function isAbsolutePath(filePath: string): boolean {
  if (path.isAbsolute(filePath)) return true
  if (/^[a-zA-Z]:[/\\]/.test(filePath)) return true
  return false
}

function resolveRelativePath(relativePath: string, baseDir: string): string {
  if (isAbsolutePath(relativePath)) return relativePath
  return path.resolve(baseDir, relativePath)
}

export function parseWorkspaceFile(content: string, filePath: string): WorkspaceFile {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new Error("Invalid JSON in workspace file")
  }

  try {
    const data = Schema.decodeUnknownSync(WorkspaceFileSchema)(parsed)
    const baseDir = path.dirname(filePath)

    return {
      folders: data.folders.map((folder) => ({
        path: resolveRelativePath(folder.path, baseDir),
        name: folder.name,
      })),
      settings: data.settings,
      extensions: data.extensions,
      launch: data.launch,
    }
  } catch (e) {
    throw new Error(`Invalid workspace file format: ${String(e)}`)
  }
}

export function serializeWorkspace(workspace: WorkspaceFile): string {
  try {
    Schema.decodeUnknownSync(WorkspaceFileSchema)(workspace)
  } catch (e) {
    throw new Error(`Invalid workspace data: ${String(e)}`)
  }

  return JSON.stringify(workspace, null, 2)
}
