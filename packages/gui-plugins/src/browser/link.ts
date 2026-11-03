import { encodeFilePath } from "@opencode/util/path"
import type { Files } from "@opencode/plugin/gui"

/** The file:// URL of a workspace-relative path. */
export function workspaceFileURL(files: Files, path: string) {
  return `file://${encodeFilePath(`${files.root.replaceAll("\\", "/").replace(/\/+$/, "")}/${path}`)}`
}
