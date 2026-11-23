import { homedir } from "node:os"
import { lstat, realpath } from "node:fs/promises"
import { createHash } from "node:crypto"
import { relative } from "node:path"
import { openContained } from "./contained-file"
import type { HandlePath } from "./handle-path"

/** Paths are relative to the workspace, never relative to the process. Do not normalize away a rejected segment. */
export function previewAllowed(root: string, document: string, path: string, entry: boolean, home: string) {
  const split = (value: string) => value.replaceAll("\\", "/").split("/")
  const doc = split(document)
  const file = split(path)

  if (
    [...doc, ...file].some(
      (part) => !part || part === "." || part === ".." || /^[a-z]:$/i.test(part) || /[\x00-\x1f]/.test(part),
    )
  )
    return false
  const same = doc.join("/") === file.join("/")

  if (entry && same && /\.html?$/i.test(document)) return true
  const folder = doc.slice(0, -1)

  if (!folder.every((part, index) => part === file[index]) || file.length <= folder.length) return false
  const windows = /^[a-z]:[\\/]|^\\\\/i.test(root)
  const name = (value: string) => (windows ? value.toLowerCase() : value).replaceAll("\\", "/").replace(/\/+$/, "")
  const directory = name(`${root.replace(/[\\/]+$/, "")}/${folder.join("/")}`)

  if (!directory || /^[a-z]:$/i.test(directory) || /^\/\/[^/]+\/[^/]+$/.test(directory)) return false

  if (
    ["", "/Desktop", "/Documents", "/Downloads", "/AppData", "/AppData/Local", "/AppData/Roaming", "/Library"].some(
      (suffix) => directory === name(home + suffix),
    )
  )
    return false

  // The grant already names this workspace. Protect hidden and secret paths beneath it, not its ancestors.
  return !file.some(
    (part) =>
      part.startsWith(".") ||
      /^(?:id_(?:rsa|dsa|ecdsa|ed25519)|credentials|secrets\..*|.*\.(?:pem|key|pfx|p12))$/i.test(part),
  )
}

/** The remote wire representation is opaque; never send the physical server path or a lossy numeric inode. */
export async function previewRoot(workspace: string) {
  const path = await realpath(workspace)
  const info = await lstat(path, { bigint: true })

  if (!info.isDirectory() || info.ino === 0n) throw new Error("Cannot identify the preview root")

  return {
    path,
    id: createHash("sha256")
      .update(JSON.stringify([path, String(info.dev), String(info.ino), String(info.birthtimeNs)]))
      .digest("hex"),
  }
}

/** The grant's root must still name the original directory before and after authorizing the open file. */
export async function openPreviewFile(
  verifier: HandlePath,
  workspace: string,
  document: string,
  path: string,
  entry: boolean,
  identity: string,
) {
  if (!previewAllowed(workspace, document, path, entry, homedir())) return "denied"
  const root = await previewRoot(workspace)

  if (root.id !== identity) return "denied"
  const opened = await openContained(verifier, root.path, path)

  if (!opened) return

  if (
    previewAllowed(root.path, document, relative(root.path, opened.path), entry, homedir()) &&
    (await previewRoot(workspace).then(
      (current) => current.id === identity,
      () => false,
    ))
  )
    return { ...opened, relativePath: relative(root.path, opened.path) }
  await opened.file.close()

  return "denied"
}
