import { contextBridge, ipcRenderer } from "electron"

const api = {
  submitAdmin: (username: string, password: string) =>
    ipcRenderer.invoke("login-admin", username, password) as Promise<boolean>,
  startMicrosoftOAuth: () => ipcRenderer.invoke("login-microsoft") as Promise<void>,
}

contextBridge.exposeInMainWorld("loginApi", api)
