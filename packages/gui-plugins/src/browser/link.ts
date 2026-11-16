import { encodeFilePath } from "@opencode/util/path"
import { workspacePrefix } from "./remote-address"

/** The file:// URL of a workspace-relative path. */
export function workspaceFileURL(root: string, path: string, remoteSession?: string) {
  if (remoteSession) return `${workspacePrefix(remoteSession)}${encodeFilePath(path)}`

  return `file://${encodeFilePath(`${root.replaceAll("\\", "/").replace(/\/+$/, "")}/${path}`)}`
}

/** Only ordinary file presentation may reuse an existing (or still opening) tab. */
export function reusableFile(url: string | undefined, intent: "present" | "new") {
  return intent === "present" && url && /^(?:file|workspace):/.test(url) ? url.split(/[?#]/, 1)[0] : undefined
}
