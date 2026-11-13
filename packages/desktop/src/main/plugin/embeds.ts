import { randomUUID } from "node:crypto"
import { BaseWindow, ImageView, screen, View, type BrowserWindow, type WebContentsView } from "electron"
import type { Embed } from "@opencode/plugin/gui/main"
import type { BridgeLayout } from "@opencode/plugin/gui/host"
import { createCornerImages } from "../native/corners"
import type { Instance } from "./lifecycle"

type Entry = {
  /** The plugin instance that created the embed. */
  readonly owner: Instance
  readonly window: BrowserWindow
  readonly windowID: number
  readonly view: WebContentsView
  readonly corners: readonly ImageView[]
  cornerKey: string
  layout?: BridgeLayout
  clip?: { root: View; window?: BaseWindow }
  shown: boolean
  /** Whether the view was on screen after the last apply. */
  onscreen: boolean
  readonly listeners: Set<(visible: boolean) => void>
}

// A box edge this many CSS px from the window edge follows it while the renderer's layout catches up.
const WINDOW_GUTTER = 24

const MAX_STILL_PIXELS = 16_000_000

/**
 * The web pages main plugins hand to the host. Each stays hidden until its window's renderer lays
 * it out and the plugin shows it; the renderer's bounds already include the window zoom.
 */
export function createEmbeds() {
  const entries = new Map<string, Entry>()
  const resizing = new WeakSet<BrowserWindow>()

  const apply = (entry: Entry) => {
    if (entry.window.isDestroyed()) return
    const layout = entry.layout?.bounds
    const cutout = entry.layout?.clip
    const viewport = entry.layout?.viewport
    // The renderer measures a frame or more behind a window resize. Edges beside the window
    // edge follow it now, so the view and its corner masks do not trail inside the panel.
    // This assumes the box takes the whole change, as the side panel beside the fixed-width chat does.
    const [width = 0, height = 0] = entry.window.getContentSize()
    const zoom = entry.window.webContents.getZoomFactor()
    // A child window uses screen coordinates and must stay inside its owner.
    const clip = cutout && intersectWindow(cutout, width, height)

    // The renderer's viewport is whole CSS px, so it can be off by one CSS px plus rounding; that is not a resize.
    const follow = (inset: number, change: number) =>
      !clip && inset <= WINDOW_GUTTER * zoom && Math.abs(change) >= zoom + 1 ? change : 0

    const dx = layout && viewport ? follow(viewport.width - layout.x - layout.width, width - viewport.width) : 0
    const dy = layout && viewport ? follow(viewport.height - layout.y - layout.height, height - viewport.height) : 0

    // Renderer measurements are fractional; native views take whole DIPs.
    const bounds = layout && {
      x: Math.round(layout.x),
      y: Math.round(layout.y),
      width: Math.round(layout.width + dx),
      height: Math.round(layout.height + dy),
    }

    // The DOM scrollport can reflow during a window resize. Wait for its new measurements.
    const measured =
      !clip ||
      !viewport ||
      (Math.abs(viewport.width - width) < zoom + 1 && Math.abs(viewport.height - height) < zoom + 1)

    const placed =
      !!entry.layout?.visible &&
      !!bounds &&
      bounds.width > 0 &&
      bounds.height > 0 &&
      measured &&
      (!clip || (clip.width > 0 && clip.height > 0))

    if (placed) {
      if (
        clip &&
        (clip.x !== bounds.x || clip.y !== bounds.y || clip.width !== bounds.width || clip.height !== bounds.height)
      ) {
        const container = (entry.clip ??= createClip(entry))

        if (container.window) {
          const origin = entry.window.getContentBounds()

          container.window.setBounds({ ...clip, x: origin.x + clip.x, y: origin.y + clip.y })
        } else container.root.setBounds(clip)

        bounds.x -= clip.x
        bounds.y -= clip.y
      } else if (entry.clip) {
        attach(entry, entry.window.contentView)
        disposeClip(entry)
      }

      entry.view.setBounds(bounds)

      const size = Math.min(
        Math.round(entry.layout?.radius ?? 0),
        Math.floor(bounds.width / 2),
        Math.floor(bounds.height / 2),
      )

      const background = entry.layout?.background
      const border = entry.layout?.border
      const scale = screen.getDisplayMatching(entry.window.getBounds()).scaleFactor

      const key =
        background && size > 0 ? `${background}:${size}:${scale}:${border?.color ?? ""}:${border?.width ?? ""}` : ""

      if (background && key && key !== entry.cornerKey)
        createCornerImages(background, size, scale, border).forEach((image, index) =>
          entry.corners[index]?.setImage(image),
        )
      entry.cornerKey = key
      // Plain bounds apply in the same frame as the view's; animated ones land a frame later,
      // which exposes a square page corner whenever the panel moves.
      entry.corners.forEach((corner, index) =>
        corner.setBounds({
          x: bounds.x + (index ? bounds.width - size : 0),
          y: bounds.y + bounds.height - size,
          width: size,
          height: size,
        }),
      )
    }

    // Keep the corner layers up while the box is laid out, even before the page shows.
    // Over the DOM card they match its own rounded corners.
    const visible = placed && entry.shown
    entry.corners.forEach((corner) => corner.setVisible(placed && !!entry.cornerKey))
    entry.view.setVisible(visible)
    const child = entry.clip?.window

    if (child && !child.isDestroyed()) {
      if (!visible || !entry.window.isVisible() || entry.window.isMinimized()) child.hide()
      else if (!child.isVisible()) child.showInactive()
    }

    if (visible === entry.onscreen) return
    entry.onscreen = visible
    entry.listeners.forEach((listener) => listener(visible))
  }

  const release = (id: string) => {
    const entry = entries.get(id)

    if (!entry) return
    entries.delete(id)
    entry.listeners.clear()

    if (entry.window.isDestroyed()) return
    entry.view.setVisible(false)
    const root = entry.clip?.root ?? entry.window.contentView
    entry.corners.forEach((corner) => root.removeChildView(corner))
    root.removeChildView(entry.view)
    disposeClip(entry)
  }

  const owned = (windowID: number, id: string) => {
    const entry = entries.get(id)

    return entry?.windowID === windowID ? entry : undefined
  }

  return {
    create(owner: Instance, view: WebContentsView, window: BrowserWindow): Embed {
      const id = randomUUID()

      if (!resizing.has(window)) {
        resizing.add(window)
        const refresh = () => entries.forEach((entry) => entry.window === window && apply(entry))
        window.on("resize", refresh)
        window.on("move", refresh)
        window.on("show", refresh)
        window.on("hide", refresh)
        window.on("restore", refresh)
        window.on("minimize", refresh)
        screen.on("display-metrics-changed", refresh)
        window.once("closed", () => screen.off("display-metrics-changed", refresh))
      }

      const corners = [new ImageView(), new ImageView()]
      view.setVisible(false)
      window.contentView.addChildView(view)
      corners.forEach((corner) => {
        // Painting above a WebContentsView needs a composited layer; a zero blur creates one
        // without an animated bounds update.
        corner.setBackgroundBlur(0)
        corner.setVisible(false)
        window.contentView.addChildView(corner)
      })

      const entry: Entry = {
        owner,
        window,
        windowID: window.id,
        view,
        corners,
        cornerKey: "",
        shown: false,
        onscreen: false,
        listeners: new Set(),
      }

      entries.set(id, entry)

      return {
        id,
        show(visible) {
          entry.shown = visible

          if (entries.get(id) === entry) apply(entry)
        },
        on(_event, handler) {
          entry.listeners.add(handler)

          return () => {
            entry.listeners.delete(handler)
          }
        },
        capture: () => capture(entry),
        dispose: () => release(id),
      }
    },
    layout(windowID: number, id: string, layout?: BridgeLayout) {
      const entry = owned(windowID, id)

      if (!entry) return
      entry.layout = layout
      apply(entry)
    },
    capture(windowID: number, id: string) {
      const entry = owned(windowID, id)

      return entry ? capture(entry) : Promise.resolve(undefined)
    },
    /** The window's renderer is reloading; it lays its embeds out again once it is back. */
    reset(windowID: number) {
      entries.forEach((entry) => {
        if (entry.windowID !== windowID) return
        entry.layout = undefined
        apply(entry)
      })
    },
    releaseWindow(windowID: number) {
      entries.forEach((entry, id) => {
        if (entry.windowID === windowID) release(id)
      })
    },
    /** Releases one plugin instance's embeds; a replacement of the same plugin keeps its own. */
    releaseOwner(owner: Instance) {
      entries.forEach((entry, id) => {
        if (entry.owner === owner) release(id)
      })
    },
  }
}

function intersectWindow(box: Electron.Rectangle, width: number, height: number) {
  const x = Math.max(0, Math.ceil(box.x))
  const y = Math.max(0, Math.ceil(box.y))

  return {
    x,
    y,
    width: Math.max(0, Math.min(width, Math.floor(box.x + box.width)) - x),
    height: Math.max(0, Math.min(height, Math.floor(box.y + box.height)) - y),
  }
}

function attach(entry: Entry, root: View) {
  root.addChildView(entry.view)
  entry.corners.forEach((corner) => root.addChildView(corner))
}

// On Cocoa a parent View clips the page's pixels; hit testing requires an owned window.
function createClip(entry: Entry) {
  const window =
    process.platform === "darwin"
      ? new BaseWindow({
          parent: entry.window,
          frame: false,
          roundedCorners: false,
          hasShadow: false,
          acceptFirstMouse: true,
          resizable: false,
          minimizable: false,
          maximizable: false,
          fullscreenable: false,
          skipTaskbar: true,
          show: false,
        })
      : undefined

  const root = window?.contentView ?? new View()

  if (!window) entry.window.contentView.addChildView(root)
  attach(entry, root)

  return { root, window }
}

function disposeClip(entry: Entry) {
  const clip = entry.clip

  if (!clip) return
  entry.clip = undefined

  if (clip.window) {
    if (!clip.window.isDestroyed()) clip.window.destroy()
  } else entry.window.contentView.removeChildView(clip.root)
}

// Freezes the shown page so the renderer can paint it under DOM overlays while the view hides.
async function capture(entry: Entry) {
  if (entry.window.isDestroyed() || entry.view.webContents.isDestroyed() || !entry.view.getVisible()) return
  const { width, height } = entry.view.getBounds()

  // Even a small cutout needs a still of the full view at native density.
  const scale = screen.getDisplayMatching((entry.clip?.window ?? entry.window).getBounds()).scaleFactor

  if (width <= 0 || height <= 0 || Math.ceil(width * scale) * Math.ceil(height * scale) > MAX_STILL_PIXELS) return
  const image = await entry.view.webContents.capturePage({ x: 0, y: 0, width, height })

  return image.isEmpty() ? undefined : image
}
