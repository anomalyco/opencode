"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
// Add electron class to body for CSS styling
window.addEventListener("DOMContentLoaded", () => {
    document.body.classList.add("electron");
    document.body.dataset.platform = process.platform;
});
// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
electron_1.contextBridge.exposeInMainWorld("electronAPI", {
    // Example: Send message to main process
    send: (channel, data) => {
        // Whitelist channels
        const validChannels = ["new-session", "close-session"];
        if (validChannels.includes(channel)) {
            electron_1.ipcRenderer.send(channel, data);
        }
    },
    // Example: Receive message from main process
    on: (channel, callback) => {
        const validChannels = ["new-session", "session-updated"];
        if (validChannels.includes(channel)) {
            electron_1.ipcRenderer.on(channel, (_event, data) => callback(data));
        }
    },
    // Example: Remove listener
    removeListener: (channel, callback) => {
        const validChannels = ["new-session", "session-updated"];
        if (validChannels.includes(channel)) {
            electron_1.ipcRenderer.removeListener(channel, callback);
        }
    },
    // Platform info
    platform: process.platform,
    isElectron: true,
});
