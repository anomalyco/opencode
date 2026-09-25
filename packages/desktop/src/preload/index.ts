import { contextBridge, ipcRenderer, webUtils } from "electron"
import {
  DragCancelEvent,
  IpcTransportPort,
  StorageSnapshotChannel,
  storageSnapshotNames,
  type StorageSnapshot,
} from "../shared/ipc-transport"
import { windowBootstrapFromArguments } from "../shared/window-bootstrap"

ipcRenderer.on(IpcTransportPort, (event) => {
  const port = event.ports[0]
  if (port) window.postMessage(IpcTransportPort, "*", [port])
})

ipcRenderer.on(DragCancelEvent, () => window.dispatchEvent(new Event(DragCancelEvent)))

const bootstrap = windowBootstrapFromArguments(process.argv)
// Asked before the page runs, so the stores the shell reads are hydrated on the first render.
const storageSnapshot: Promise<StorageSnapshot> = ipcRenderer
  .invoke(StorageSnapshotChannel, storageSnapshotNames(bootstrap.id))
  .catch(() => ({}))

contextBridge.exposeInMainWorld("electron", {
  windowID: bootstrap.id,
  bootstrap,
  storageSnapshot,
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
})
