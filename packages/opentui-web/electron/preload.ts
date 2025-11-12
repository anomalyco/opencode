import { contextBridge, ipcRenderer } from "electron"

// Add electron class to body for CSS styling
window.addEventListener("DOMContentLoaded", () => {
  document.body.classList.add("electron")
  document.body.dataset.platform = process.platform
})

// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld("electronAPI", {
  // Example: Send message to main process
  send: (channel: string, data: unknown) => {
    // Whitelist channels
    const validChannels = ["new-session", "close-session"]
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data)
    }
  },

  // Example: Receive message from main process
  on: (channel: string, callback: (data: unknown) => void) => {
    const validChannels = ["new-session", "session-updated"]
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (_event: any, data: any) => callback(data))
    }
  },

  // Example: Remove listener
  removeListener: (channel: string, callback: (data: unknown) => void) => {
    const validChannels = ["new-session", "session-updated"]
    if (validChannels.includes(channel)) {
      ipcRenderer.removeListener(channel, callback)
    }
  },

  // Platform info
  platform: process.platform,
  isElectron: true,
})
