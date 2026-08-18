import { ACCEPTED_FILE_EXTENSIONS, ServerConnection, type Platform, type UpdaterPlatform } from "@opencode-ai/app"
import type { ElectronAPI } from "../api-types"
import { setPinchZoomEnabled, webviewZoom } from "../window/zoom"
import { windowFullscreen } from "../window/fullscreen"
import { createDesktopFiles } from "./files"
import { createDesktopMenuAction } from "./menu"
import { createDesktopNotify } from "./notifications"
import { createDesktopStorage } from "./storage"

export type DesktopWindowState = {
  id: string
  version: string
}

export function createDesktopPlatform(
  api: ElectronAPI,
  windowState: DesktopWindowState,
  updater: UpdaterPlatform,
): Platform {
  const os = desktopOS()
  return {
    platform: "desktop",
    os,
    version: windowState.version,
    windowID: windowState.id,
    ...createDesktopFiles(api, os, ACCEPTED_FILE_EXTENSIONS),
    ...createDesktopStorage(api),
    updater,
    exportDebugLogs: () => api.exportDebugLogs(),
    setForceFocus: (enabled) => api.setForceFocus(enabled),
    recordFatalRendererError: (error) => api.recordFatalRendererError(error),
    restart: async () => api.relaunch(),
    notify: createDesktopNotify(api),
    fetch: (input, init) => {
      if (input instanceof Request) return fetch(input)
      return fetch(input, init)
    },
    getDefaultServer: async () => {
      const url = await api.getDefaultServerUrl().catch(() => null)
      if (!url) return null
      return ServerConnection.Key.make(url)
    },
    setDefaultServer: async (url) => {
      await api.setDefaultServerUrl(url)
    },
    wslServers: os === "windows" ? api.wslServers : undefined,
    webviewZoom,
    windowFullscreen,
    getPinchZoomEnabled: () => api.getPinchZoomEnabled(),
    setPinchZoomEnabled,
    runDesktopMenuAction: createDesktopMenuAction(api),
    checkAppExists: async (appName) => {
      return api.checkAppExists(appName)
    },
  }
}

function desktopOS() {
  if (navigator.userAgent.includes("Mac")) return "macos"
  if (navigator.userAgent.includes("Windows")) return "windows"
  if (navigator.userAgent.includes("Linux")) return "linux"
  return undefined
}
