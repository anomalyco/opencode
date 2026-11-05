import { app, ipcMain, type WebContents } from "electron"
import { WindowSnapshotChannel, type WindowSnapshot } from "../../shared/ipc-transport"
import { isRendererUrl } from "../windows/scheme"
import { readWindowSnapshot } from "./window-snapshot"

// A window's preload asks for the namespaces its shell reads before the page runs, so the first
// render is the hydrated one. Until the storage layer is up (the first window asks before it exists)
// the answer comes from the database file; the layer takes over so later windows see queued writes.
type Provider = (names: ReadonlyArray<string>) => WindowSnapshot

let provider: Provider = (names) => readWindowSnapshot(app.getPath("userData"), names)

export function setStorageSnapshotProvider(next: Provider) {
  provider = next
}

// Hears about a snapshot just before it is read, so the window holds the changes made after it
// until its document can receive them.
let observer: ((sender: WebContents) => void) | undefined

export function setStorageSnapshotObserver(next: (sender: WebContents) => void) {
  observer = next

  return () => {
    if (observer === next) observer = undefined
  }
}

export function registerStorageSnapshotHandler() {
  // SAFETY: Electron delivers untrusted IPC arguments; accept only an array whose every element is a string here.
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- see SAFETY above
  ipcMain.handle(WindowSnapshotChannel, (event, names: unknown): WindowSnapshot => {
    if (!isRendererUrl(event.senderFrame?.url)) return { storage: {} }

    // SAFETY: this dependency-free boundary check establishes the complete array-of-strings contract.
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- see SAFETY above
    if (!Array.isArray(names) || !names.every((name) => typeof name === "string")) return { storage: {} }

    observer?.(event.sender)

    return provider(names)
  })
}
