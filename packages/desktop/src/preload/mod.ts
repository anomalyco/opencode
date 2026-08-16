import { contextBridge, ipcRenderer } from "electron"

const id = process.argv.find((value) => value.startsWith("--opencode-mod="))?.slice("--opencode-mod=".length)

if (!id) throw new Error("MOD window is missing an identity")

const api = {
  getManifest: () => ipcRenderer.invoke("mod-get-manifest"),
  storage: {
    get: (key: string) => ipcRenderer.invoke("mod-storage-get", key),
    set: (key: string, value: string) => ipcRenderer.invoke("mod-storage-set", key, value),
    delete: (key: string) => ipcRenderer.invoke("mod-storage-delete", key),
  },
  openExternal: (url: string) => ipcRenderer.invoke("mod-open-external", url),
  close: () => ipcRenderer.invoke("mod-close-window"),
}

contextBridge.exposeInMainWorld("opencodeMod", api)
