import { containsDirectory, encodeFilePath, sameDirectory } from "@opencode/util/path"
import { workspacePrefix } from "./remote-address"

/** Whether a path is a local absolute path (POSIX or Windows drive), excluding UNC/network shares. */
export function isLocalAbsolutePath(path: string) {
  return (path.startsWith("/") && !path.startsWith("//")) || /^[a-zA-Z]:[/\\]/.test(path)
}

/** Whether a local absolute path points strictly inside one of the allowed roots without traversal segments. */
export function pathWithinRoots(path: string, roots: readonly string[]) {
  if (!roots.length || !isLocalAbsolutePath(path) || path.includes("\0")) return false

  if (path.split(/[\\/]/).some((part) => part === "." || part === "..")) return false

  return roots.some((root) => containsDirectory(root, path) && !sameDirectory(root, path))
}

/** The file:// URL of a workspace-relative path or local absolute path. */
export function workspaceFileURL(root: string, path: string, remoteSession?: string) {
  if (remoteSession) return `${workspacePrefix(remoteSession)}${encodeFilePath(path)}`

  if (isLocalAbsolutePath(path)) return `file://${encodeFilePath(path)}`

  return `file://${encodeFilePath(`${root.replaceAll("\\", "/").replace(/\/+$/, "")}/${path}`)}`
}

/** Only ordinary file presentation may reuse an existing (or still opening) tab. */
export function reusableFile(url: string | undefined, intent: "present" | "new") {
  return intent === "present" && url && /^(?:file|workspace):/.test(url) ? url.split(/[?#]/, 1)[0] : undefined
}

/** The tab that already shows this file, whatever query or fragment its address has. Opening the file again reloads that tab. */
export function fileTab<Tab extends { readonly url: string }>(tabs: readonly Tab[], file: string) {
  return tabs.find((tab) => tab.url.split(/[?#]/, 1)[0] === file)
}
