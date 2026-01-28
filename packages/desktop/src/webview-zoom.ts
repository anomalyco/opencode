// Copyright 2019-2024 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

import { invoke } from "@tauri-apps/api/core"
import { type as ostype } from "@tauri-apps/plugin-os"

const OS_NAME = ostype()

let zoomLevel = 1

const MAX_ZOOM_LEVEL = 10
const MIN_ZOOM_LEVEL = 0.2

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
  }
})
