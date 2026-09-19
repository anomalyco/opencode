import { contextBridge, ipcRenderer, webUtils } from "electron"
import { DragCancelEvent, IpcTransportPort, IpcTransportPortRequest } from "../shared/ipc-transport"
import { windowIDFromArguments } from "../shared/window-bootstrap"

ipcRenderer.on(IpcTransportPort, (event) => {
  const port = event.ports[0]
  if (port) window.postMessage(IpcTransportPort, "*", [port])
})

ipcRenderer.on(DragCancelEvent, () => window.dispatchEvent(new Event(DragCancelEvent)))

contextBridge.exposeInMainWorld("electron", {
  windowID: windowIDFromArguments(process.argv),
  requestRpcPort: () => ipcRenderer.send(IpcTransportPortRequest),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
})
