// Copyright 2019-2024 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

import { createSignal } from "solid-js"

const OS_NAME = (() => {
  if (navigator.userAgent.includes("Mac")) return "macos"
  if (navigator.userAgent.includes("Windows")) return "windows"
  if (navigator.userAgent.includes("Linux")) return "linux"
  return "unknown"
})()

const [webviewZoom, setWebviewZoom] = createSignal(1)
let requestedZoom = 1

const MAX_ZOOM_LEVEL = 10
const MIN_ZOOM_LEVEL = 0.2

const clamp = (value: number) => Math.min(Math.max(value, MIN_ZOOM_LEVEL), MAX_ZOOM_LEVEL)

const applyZoom = (next: number) => {
  requestedZoom = next
  void window.api
    .setZoomFactor(next)
    .then(() => {
      if (requestedZoom !== next) return
      setWebviewZoom(next)
    })
    .catch(() => {
      if (requestedZoom !== next) return
      requestedZoom = webviewZoom()
    })
}

window.addEventListener("keydown", (event) => {
  if (!(OS_NAME === "macos" ? event.metaKey : event.ctrlKey)) return

  if (event.key === "-") {
    event.preventDefault()
    applyZoom(clamp(requestedZoom - 0.2))
    return
  }
  if (event.key === "=" || event.key === "+") {
    event.preventDefault()
    applyZoom(clamp(requestedZoom + 0.2))
    return
  }
  if (event.key === "0") {
    event.preventDefault()
    applyZoom(1)
  }
})

export { webviewZoom }
