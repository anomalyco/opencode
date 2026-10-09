import { randomUUID } from "node:crypto"
import { ImageView, screen, type BrowserWindow, type WebContentsView } from "electron"
import type { BridgeLayout } from "@opencode/gui-extensions/sdk/bridge"
import type { Embed } from "@opencode/gui-extensions/sdk/main"
import { createCornerImages } from "../native/corners"
import type { Instance } from "./lifecycle"

type Entry = {
  /** The extension instance that created the embed. */
  readonly owner: Instance
  readonly window: BrowserWindow
  readonly windowID: number
  readonly view: WebContentsView
  readonly corners: readonly ImageView[]
  cornerKey: string
  layout?: BridgeLayout
  shown: boolean
  /** Whether the view was on screen after the last apply. */
  onscreen: boolean
  readonly listeners: Set<(visible: boolean) => void>
}

// A box edge this many CSS px from the window edge follows it while the renderer's layout catches up.
const WINDOW_GUTTER = 24

/**
 * The web pages main extensions hand to the host. Each stays hidden until its window's renderer lays
 * it out and the extension shows it; the renderer's bounds already include the window zoom.
 */
export function createEmbeds() {
  const entries = new Map<string, Entry>()
  const resizing = new WeakSet<BrowserWindow>()

  const apply = (entry: Entry) => {
    if (entry.window.isDestroyed()) return
    const layout = entry.layout?.bounds
    const viewport = entry.layout?.viewport
    // The renderer measures a frame or more behind a window resize. Edges beside the window
    // edge follow it now, so the view and its corner masks do not trail inside the panel.
    // This assumes the box takes the whole change, as the side panel beside the fixed-width chat does.
    const [width = 0, height = 0] = entry.window.getContentSize()
    const zoom = entry.window.webContents.getZoomFactor()

    // The renderer's viewport is whole CSS px, so it can be off by one CSS px plus rounding; that is not a resize.
    const follow = (inset: number, change: number) =>
      inset <= WINDOW_GUTTER * zoom && Math.abs(change) >= zoom + 1 ? change : 0

    const dx = layout && viewport ? follow(viewport.width - layout.x - layout.width, width - viewport.width) : 0
    const dy = layout && viewport ? follow(viewport.height - layout.y - layout.height, height - viewport.height) : 0

    // Renderer measurements are fractional; native views take whole DIPs.
    const bounds = layout && {
      x: Math.round(layout.x),
      y: Math.round(layout.y),
      width: Math.round(layout.width + dx),
      height: Math.round(layout.height + dy),
    }

    const placed = !!entry.layout?.visible && !!bounds && bounds.width > 0 && bounds.height > 0

    if (placed && bounds) {
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
    entry.corners.forEach((corner) => entry.window.contentView.removeChildView(corner))
    entry.window.contentView.removeChildView(entry.view)
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
        window.on("resize", () => entries.forEach((entry) => entry.window === window && apply(entry)))
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
    /** Releases one extension instance's embeds; a replacement of the same extension keeps its own. */
    releaseOwner(owner: Instance) {
      entries.forEach((entry, id) => {
        if (entry.owner === owner) release(id)
      })
    },
  }
}

// Freezes the shown page so the renderer can paint it under DOM overlays while the view hides.
async function capture(entry: Entry) {
  if (entry.window.isDestroyed() || entry.view.webContents.isDestroyed() || !entry.view.getVisible()) return
  const image = await entry.view.webContents.capturePage()

  return image.isEmpty() ? undefined : image
}
