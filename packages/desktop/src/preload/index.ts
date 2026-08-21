import { contextBridge, ipcRenderer, webUtils } from "electron"
import { IpcTransportPort } from "../shared/ipc-transport"

ipcRenderer.on(IpcTransportPort, (event) => {
  const port = event.ports[0]
  if (port) window.postMessage(IpcTransportPort, "*", [port])
})

contextBridge.exposeInMainWorld("electron", {
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
})
