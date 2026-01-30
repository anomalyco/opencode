// Copyright 2019-2024 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

import { invoke } from "@tauri-apps/api/core"
import { type as ostype } from "@tauri-apps/plugin-os"
import { Store } from "@tauri-apps/plugin-store"

const OS_NAME = ostype()

const MAX_ZOOM_LEVEL = 10
const MIN_ZOOM_LEVEL = 0.2

// Load initial zoom level from store
let zoomLevel = 1
;(async () => {
  try {
    const store = await Store.load("opencode.settings.dat")
    const stored = await store.get<{ appearance?: { zoomLevel?: number } }>("settings.v3")
    if (stored?.appearance?.zoomLevel) {
      zoomLevel = stored.appearance.zoomLevel
      await invoke("plugin:webview|set_webview_zoom", {
        value: zoomLevel,
      })
    }
  } catch (err) {
    console.error("Failed to load zoom level:", err)
  }
})()

// Save zoom level to store
async function saveZoomLevel(value: number) {
  try {
    const store = await Store.load("opencode.settings.dat")
    const current = (await store.get<{ appearance?: { zoomLevel?: number } }>("settings.v3")) || {}
    await store.set("settings.v3", {
      ...current,
      appearance: {
        ...current.appearance,
        zoomLevel: value,
      },
    })
    await store.save()
  } catch (err) {
    console.error("Failed to save zoom level:", err)
  }
}

window.addEventListener("keydown", (event) => {
  if (OS_NAME === "macos" ? event.metaKey : event.ctrlKey) {
    if (event.key === "-") {
      zoomLevel -= 0.2
    } else if (event.key === "=" || event.key === "+") {
      zoomLevel += 0.2
    } else if (event.key === "0") {
      zoomLevel = 1
    } else {
      return
    }
    zoomLevel = Math.min(Math.max(zoomLevel, MIN_ZOOM_LEVEL), MAX_ZOOM_LEVEL)
    invoke("plugin:webview|set_webview_zoom", {
      value: zoomLevel,
    })
    saveZoomLevel(zoomLevel)
  }
})

// Export function to allow programmatic zoom level changes
export function setZoomLevel(value: number) {
  zoomLevel = Math.min(Math.max(value, MIN_ZOOM_LEVEL), MAX_ZOOM_LEVEL)
  invoke("plugin:webview|set_webview_zoom", {
    value: zoomLevel,
  })
  saveZoomLevel(zoomLevel)
  return zoomLevel
}

export function getZoomLevel() {
  return zoomLevel
}
