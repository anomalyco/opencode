import { mkdir, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { app } from "electron"

// The shell snapshot a window shows before its renderer has booted. It is a file next to the
// window-state JSON rather than a row in the desktop database because the entry module serves it
// before the storage layers exist; a snapshot from another app version is ignored, since its class
// names may no longer match the bundled stylesheet.

export function prepaintFile(id: string) {
  return `prepaint-${id.replace(/[^a-zA-Z0-9._-]/g, "-")}.html`
}

export function prepaintMarker(version: string) {
  return `<!-- opencode ${version} -->`
}

export async function writePrepaint(id: string, html: string) {
  const file = path.join(app.getPath("userData"), prepaintFile(id))
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(`${file}.tmp`, `${prepaintMarker(app.getVersion())}\n${html}`)
  await rename(`${file}.tmp`, file)
}

export function removePrepaint(id: string) {
  return rm(path.join(app.getPath("userData"), prepaintFile(id)), { force: true })
}
