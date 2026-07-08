import path from "path"
import fsSync from "node:fs"
import { Global } from "../global"
import { AbsolutePath } from "../schema"

// Canonical paths for OpenWork instructions.
//   Global  — applies across every work folder:  ~/.config/opencode/work-instructions.md
//   Folder  — applies to one work folder:        <folder>/FOLDER.md (also scaffolded)
export const paths = {
  global: path.join(Global.Path.config, "work-instructions.md") as AbsolutePath,
  folder: (folder: AbsolutePath) => path.join(folder, "FOLDER.md") as AbsolutePath,
}

// Read global + folder instructions for a work folder, synchronously.
// Missing files are treated as empty so the work agent can run before the user
// curates instructions. Pure function, no Effect requirements, no async boundary —
// keeping this sync lets the system-prompt builder read it inline without dragging
// FileSystem into the Effect requirements of the surrounding environment().
export function read(folder: AbsolutePath): { global: string; folder: string } {
  return { global: readOptional(paths.global), folder: readOptional(paths.folder(folder)) }
}

export function readGlobal(): string {
  return readOptional(paths.global)
}

export function writeGlobal(content: string): void {
  fsSync.mkdirSync(path.dirname(paths.global), { recursive: true })
  fsSync.writeFileSync(paths.global, content)
}

export function writeFolder(folder: AbsolutePath, content: string): void {
  fsSync.writeFileSync(paths.folder(folder), content)
}

function readOptional(file: string): string {
  try {
    return fsSync.readFileSync(file, "utf8")
  } catch {
    return ""
  }
}