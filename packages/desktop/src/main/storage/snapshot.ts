import { existsSync, readdirSync } from "node:fs"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { app, ipcMain } from "electron"
import { StorageSnapshotChannel, type StorageSnapshot } from "../../shared/ipc-transport"
import { isRendererUrl } from "../windows/scheme"

// A window's preload asks for the namespaces its shell reads before the page runs, so the first
// render is the hydrated one. Until the storage layer is up (the first window asks before it exists)
// the answer comes from the database file; the layer takes over so later windows see queued writes.
type Provider = (names: ReadonlyArray<string>) => StorageSnapshot

let provider: Provider = readFromDisk

export function setStorageSnapshotProvider(next: Provider) {
  provider = next
}

export function registerStorageSnapshotHandler() {
  ipcMain.handle(StorageSnapshotChannel, (event, names: unknown): StorageSnapshot => {
    if (!isRendererUrl(event.senderFrame?.url)) return {}
    if (!Array.isArray(names)) return {}
    return provider(names.filter((name): name is string => typeof name === "string"))
  })
}

// Nothing has been written in this process yet, so every namespace is at revision 0, as the
// storage layer would report before its first update. Legacy electron-store files still waiting
// to be imported would make the database stale for this launch, so the renderer asks the layer then.
function readFromDisk(names: ReadonlyArray<string>): StorageSnapshot {
  const userData = app.getPath("userData")
  const file = path.join(userData, "drafts.sqlite")
  if (!existsSync(file)) return {}
  if (readdirSync(userData).some((name) => name === "default.dat" || /^opencode\..+\.dat$/.test(name))) return {}
  try {
    const db = new DatabaseSync(file)
    try {
      const rows = db.prepare("SELECT key, value FROM state WHERE name = ?")
      return Object.fromEntries(
        names.map((name) => [
          name,
          {
            items: Object.fromEntries(
              (rows.all(name) as { key: string; value: string }[]).map((row) => [row.key, row.value]),
            ),
            revision: 0,
          },
        ]),
      )
    } finally {
      db.close()
    }
  } catch {
    return {}
  }
}
