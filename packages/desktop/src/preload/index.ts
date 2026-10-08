import { contextBridge, ipcRenderer, webUtils } from "electron"
import {
  DragCancelEvent,
  IpcTransportPort,
  WindowSnapshotChannel,
  storageSnapshotNames,
  type WindowSnapshot,
} from "../shared/ipc-transport"
import { windowBootstrapFromArguments } from "../shared/window-bootstrap"

ipcRenderer.on(IpcTransportPort, (event) => {
  const port = event.ports[0]

  if (port) window.postMessage(IpcTransportPort, "*", [port])
})

ipcRenderer.on(DragCancelEvent, () => window.dispatchEvent(new Event(DragCancelEvent)))

const bootstrap = windowBootstrapFromArguments(process.argv)

// Asked before the page runs, so the stores the shell reads are hydrated on the first render.
const snapshot: Promise<WindowSnapshot> = ipcRenderer
  .invoke(WindowSnapshotChannel, storageSnapshotNames(bootstrap.id))
  .catch(() => ({ storage: {} }))

contextBridge.exposeInMainWorld("electron", {
  windowID: bootstrap.id,
  bootstrap,
  storageSnapshot: snapshot.then((snapshot) => snapshot.storage),
  extensions: snapshot.then((snapshot) => snapshot.extensions),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
})
