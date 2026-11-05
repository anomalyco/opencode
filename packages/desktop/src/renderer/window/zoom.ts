// Copyright 2019-2024 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

import { nextDesktopZoomLevel, type DesktopZoomLevel } from "@opencode/app/desktop-menu"
import { createSignal } from "solid-js"
import { api } from "../api"
import {
  createZoomState,
  selectRequestedZoom,
  selectWebviewZoom,
  selectZoomLevel,
  transitionZoom,
  WHEEL_PINCH_END_DELAY,
  type ZoomEffect,
  type ZoomEvent,
} from "./zoom-machine"

const OS_NAME = (() => {
  if (navigator.userAgent.includes("Mac")) return "macos"

  if (navigator.userAgent.includes("Windows")) return "windows"

  if (navigator.userAgent.includes("Linux")) return "linux"

  return "unknown"
})()

const [webviewZoom, setWebviewZoom] = createSignal(1)

const [zoomLevel, setZoomLevelSignal] = createSignal<DesktopZoomLevel>(1)

let state = createZoomState()

let pinchTimer: ReturnType<typeof setTimeout> | undefined

// Reused for every wheel frame, so a pinch gesture allocates no event objects.
const wheelEvent: Extract<ZoomEvent, { type: "wheel.pinched" }> = { type: "wheel.pinched", delta: 0 }

const endPinch: ZoomEvent = { type: "pinch.ended" }

const dispatch = (event: ZoomEvent) => {
  const next = transitionZoom(state, event)

  if (next.state !== state) {
    state = next.state
    setWebviewZoom(selectWebviewZoom(state))
    setZoomLevelSignal(selectZoomLevel(state))
  }

  next.effects.forEach(run)
}

const run = (effect: ZoomEffect) => {
  if (effect.type === "arm-pinch-timer") {
    clearTimeout(pinchTimer)
    pinchTimer = setTimeout(() => dispatch(endPinch), WHEEL_PINCH_END_DELAY)

    return
  }

  if (effect.type === "cancel-pinch-timer") {
    clearTimeout(pinchTimer)
    pinchTimer = undefined

    return
  }

  // A cancelable window wheel listener makes every scroll gesture wait for the main thread, so it
  // is only attached while pinch zoom is on. Main's zoom-changed handler covers Ctrl+wheel otherwise.
  if (effect.type === "sync-wheel-listener") {
    if (!effect.enabled) return window.removeEventListener("wheel", onWheelPinch)
    window.addEventListener("wheel", onWheelPinch, { passive: false })

    return
  }

  if (effect.type === "set-zoom-factor") {
    void api.setZoomFactor(effect.factor).then(
      () => dispatch({ type: "factor.succeeded", attempt: effect.attempt }),
      () => dispatch({ type: "factor.failed", attempt: effect.attempt }),
    )

    return
  }

  if (effect.type === "set-zoom-level") {
    void api.setZoomLevel(effect.level).then(
      () => {
        dispatch({ type: "level.succeeded", attempt: effect.attempt })
        effect.reply.resolve()
      },
      (error: unknown) => {
        dispatch({ type: "level.failed", attempt: effect.attempt })
        effect.reply.reject(error)
      },
    )

    return
  }

  void api.setPinchZoomEnabled(effect.enabled).then(
    () => {
      dispatch({ type: "pinch.succeeded", attempt: effect.attempt })
      effect.reply.resolve()
    },
    (error: unknown) => {
      dispatch({ type: "pinch.failed", attempt: effect.attempt })
      effect.reply.reject(error)
    },
  )
}

// A renderer reload keeps the window's zoom, so seed it from main unless something newer already set it.
void api.getZoomFactor().then(
  (factor) => dispatch({ type: "factor.seeded", factor }),
  () => dispatch({ type: "factor.seed-failed" }),
)

void api.getZoomLevel().then(
  (level) => dispatch({ type: "level.seeded", level }),
  () => dispatch({ type: "level.seed-failed" }),
)

api.onZoomChanged((zoom) => dispatch({ type: "zoom.changed", factor: zoom.factor, level: zoom.level }))

void api.getPinchZoomEnabled().then(
  (enabled) => dispatch({ type: "pinch.seeded", enabled }),
  () => undefined,
)

api.onPinchZoomEnabledChanged((enabled) => dispatch({ type: "pinch.changed", enabled }))

const setPinchZoomEnabled = (enabled: boolean) =>
  new Promise<void>((resolve, reject) => dispatch({ type: "pinch.requested", enabled, reply: { resolve, reject } }))

// Main saves the level and applies it to every window, then reports the new zoom back.
const setZoomLevel = (level: DesktopZoomLevel) =>
  new Promise<void>((resolve, reject) => dispatch({ type: "level.requested", level, reply: { resolve, reject } }))

// A refused step was already rolled back by the machine; the keyboard shortcuts have no caller to report it to.
const stepZoom = (level: DesktopZoomLevel) => void setZoomLevel(level).catch(() => undefined)

const resetZoom = () => stepZoom(1)

const zoomIn = () => stepZoom(nextDesktopZoomLevel(selectRequestedZoom(state), "in"))

const zoomOut = () => stepZoom(nextDesktopZoomLevel(selectRequestedZoom(state), "out"))

const normalizeWheelDelta = (event: WheelEvent) => {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaY * 16

  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return event.deltaY * window.innerHeight

  return event.deltaY
}

const onWheelPinch = (event: WheelEvent) => {
  if (!event.ctrlKey) return

  event.preventDefault()
  wheelEvent.delta = normalizeWheelDelta(event)
  dispatch(wheelEvent)
}

window.addEventListener("keydown", (event) => {
  if (!(OS_NAME === "macos" ? event.metaKey : event.ctrlKey)) return

  if (event.key === "-") {
    event.preventDefault()
    zoomOut()

    return
  }

  if (event.key === "=" || event.key === "+") {
    event.preventDefault()
    zoomIn()

    return
  }

  if (event.key === "0") {
    event.preventDefault()
    resetZoom()
  }
})

export { webviewZoom, zoomLevel, resetZoom, setPinchZoomEnabled, setZoomLevel, zoomIn, zoomOut }
