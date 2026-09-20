import { contextBridge, ipcRenderer, webUtils } from "electron"
import { DragCancelEvent, IpcTransportPort } from "../shared/ipc-transport"
import { windowBootstrapFromArguments } from "../shared/window-bootstrap"

ipcRenderer.on(IpcTransportPort, (event) => {
  const port = event.ports[0]
  if (port) window.postMessage(IpcTransportPort, "*", [port])
})

ipcRenderer.on(DragCancelEvent, () => window.dispatchEvent(new Event(DragCancelEvent)))

const bootstrap = windowBootstrapFromArguments(process.argv)

contextBridge.exposeInMainWorld("electron", {
  windowID: bootstrap.id,
  bootstrap,
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
})
