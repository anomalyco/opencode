import { homedir } from "node:os"
import { realpath } from "node:fs/promises"
import { relative } from "node:path"
import { openContained } from "./contained-file.js"

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
  return ![...split(root), ...file].some(
    (part) =>
      part.startsWith(".") ||
      /^(?:id_(?:rsa|dsa|ecdsa|ed25519)|credentials|secrets\..*|.*\.(?:pem|key|pfx|p12))$/i.test(part),
  )
}

/** The same decision both before opening and on the kernel's name for the handle: an innocuous alias is not authority. */
export async function openPreviewFile(workspace: string, document: string, path: string, entry: boolean) {
  if (!previewAllowed(workspace, document, path, entry, homedir())) return "denied"
  const root = await realpath(workspace)
  const opened = await openContained(root, path)
  if (!opened) return
  if (previewAllowed(root, document, relative(root, opened.path), entry, homedir())) return opened
  await opened.file.close()
  return "denied"
}
