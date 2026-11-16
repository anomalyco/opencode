import { encodeFilePath } from "@opencode/util/path"
import { workspacePrefix } from "./remote-address"

/** The file:// URL of a workspace-relative path. */
export function workspaceFileURL(root: string, path: string, remoteSession?: string) {
  if (remoteSession) return `${workspacePrefix(remoteSession)}${encodeFilePath(path)}`

  return `file://${encodeFilePath(`${root.replaceAll("\\", "/").replace(/\/+$/, "")}/${path}`)}`
}
