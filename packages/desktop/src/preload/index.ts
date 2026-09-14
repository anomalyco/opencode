import { contextBridge, ipcRenderer, webUtils } from "electron"
import { DragCancelEvent, IpcTransportPort } from "../shared/ipc-transport"
import { windowIDFromArguments } from "../shared/window-bootstrap"

ipcRenderer.on(IpcTransportPort, (event) => {
  const port = event.ports[0]
  if (port) window.postMessage(IpcTransportPort, "*", [port])
})

ipcRenderer.on(DragCancelEvent, () => window.dispatchEvent(new Event(DragCancelEvent)))

contextBridge.exposeInMainWorld("electron", {
  windowID: windowIDFromArguments(process.argv),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
})
