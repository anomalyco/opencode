import { contextBridge, ipcRenderer } from "electron"

export interface BrowserAPI {
  navigate: (url: string) => void
  goBack: () => void
  goForward: () => void
  reload: () => void
  getUrl: () => Promise<string>
  canGoBack: () => Promise<boolean>
  canGoForward: () => Promise<boolean>
  screenshot: () => Promise<{ buffer: ArrayBuffer; width: number; height: number } | null>
  saveAnnotations: (data: string) => Promise<boolean>
  loadAnnotations: () => Promise<string | null>
  onNavigate: (cb: (url: string) => void) => () => void
  onDidNavigate: (cb: (data: { url: string; httpResponseCode: number; httpStatusText: string }) => void) => () => void
  onDidFailLoad: (cb: (data: { errorCode: number; errorDescription: string; validatedURL: string }) => void) => () => void
  onPageTitleUpdated: (cb: (title: string) => void) => () => void
}

const browserAPI: BrowserAPI = {
  navigate: (url: string) => ipcRenderer.invoke("browser-navigate", url),
  goBack: () => ipcRenderer.invoke("browser-go-back"),
  goForward: () => ipcRenderer.invoke("browser-go-forward"),
  reload: () => ipcRenderer.invoke("browser-reload"),
  getUrl: () => ipcRenderer.invoke("browser-get-url"),
  canGoBack: () => ipcRenderer.invoke("browser-can-go-back"),
  canGoForward: () => ipcRenderer.invoke("browser-can-go-forward"),
  screenshot: () => ipcRenderer.invoke("browser-screenshot"),
  saveAnnotations: (data: string) => ipcRenderer.invoke("browser-save-annotations", data),
  loadAnnotations: () => ipcRenderer.invoke("browser-load-annotations"),
  onNavigate: (cb) => {
    const handler = (_event: Electron.IpcRendererEvent, url: string) => cb(url)
    ipcRenderer.on("browser-navigate", handler)
    return () => ipcRenderer.removeListener("browser-navigate", handler)
  },
  onDidNavigate: (cb) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { url: string; httpResponseCode: number; httpStatusText: string }) => cb(data)
    ipcRenderer.on("browser-did-navigate", handler)
    return () => ipcRenderer.removeListener("browser-did-navigate", handler)
  },
  onDidFailLoad: (cb) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { errorCode: number; errorDescription: string; validatedURL: string }) => cb(data)
    ipcRenderer.on("browser-did-fail-load", handler)
    return () => ipcRenderer.removeListener("browser-did-fail-load", handler)
  },
  onPageTitleUpdated: (cb) => {
    const handler = (_event: Electron.IpcRendererEvent, title: string) => cb(title)
    ipcRenderer.on("browser-page-title-updated", handler)
    return () => ipcRenderer.removeListener("browser-page-title-updated", handler)
  },
}

contextBridge.exposeInMainWorld("browserAPI", browserAPI)
