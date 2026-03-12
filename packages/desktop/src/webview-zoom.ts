// Copyright 2019-2024 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

import { invoke } from "@tauri-apps/api/core"
import { type as ostype } from "@tauri-apps/plugin-os"
import { createSignal } from "solid-js"

const ok = () =>
  typeof window !== "undefined" &&
  ((globalThis as unknown as { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__?.invoke ??
    (globalThis as unknown as { __TAURI__?: { invoke?: unknown } }).__TAURI__?.invoke) !== undefined

const [os, setOs] = createSignal("")

void (async () => {
  if (!ok()) return
  try {
    setOs(await ostype())
  } catch {}
})()

const [webviewZoom, setWebviewZoom] = createSignal(1)

const MAX_ZOOM_LEVEL = 10
const MIN_ZOOM_LEVEL = 0.2

const clamp = (value: number) => Math.min(Math.max(value, MIN_ZOOM_LEVEL), MAX_ZOOM_LEVEL)

const applyZoom = (next: number) => {
  setWebviewZoom(next)
  if (!ok()) return
  invoke("plugin:webview|set_webview_zoom", {
    value: next,
  })
}

window.addEventListener("keydown", (event) => {
  const mac = os() === "macos" || (!ok() && /^Mac/i.test(navigator.platform))
  if (!(mac ? event.metaKey : event.ctrlKey)) return

  let newZoom = webviewZoom()

  if (event.key === "-") newZoom -= 0.2
  if (event.key === "=" || event.key === "+") newZoom += 0.2
  if (event.key === "0") newZoom = 1

  applyZoom(clamp(newZoom))
})

export { webviewZoom }
