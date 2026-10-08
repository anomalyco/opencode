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

/**
 * The web pages main extensions hand to the host. Each stays hidden until its window's renderer lays
 * it out and the extension shows it; the renderer's bounds already include the window zoom.
 */
export function createEmbeds() {
  const entries = new Map<string, Entry>()

  const apply = (entry: Entry) => {
    if (entry.window.isDestroyed()) return
    const layout = entry.layout?.bounds

    // Renderer measurements are fractional; native views take whole DIPs.
    const bounds = layout && {
      x: Math.round(layout.x),
      y: Math.round(layout.y),
      width: Math.round(layout.width),
      height: Math.round(layout.height),
    }

    const visible = !!entry.layout?.visible && entry.shown && !!bounds && bounds.width > 0 && bounds.height > 0

    if (visible && bounds) {
      entry.view.setBounds(bounds)

      const size = Math.min(
        Math.round(entry.layout?.radius ?? 0),
        Math.floor(bounds.width / 2),
        Math.floor(bounds.height / 2),
      )

      const background = entry.layout?.background
      const scale = screen.getDisplayMatching(entry.window.getBounds()).scaleFactor
      const key = background && size > 0 ? `${background}:${size}:${scale}` : ""

      if (background && key && key !== entry.cornerKey)
        createCornerImages(background, size, scale).forEach((image, index) => entry.corners[index]?.setImage(image))
      entry.cornerKey = key
      entry.corners.forEach((corner, index) =>
        // A composited layer is required above a WebContentsView; a zero-duration update creates it.
        corner.setBounds(
          {
            x: bounds.x + (index ? bounds.width - size : 0),
            y: bounds.y + bounds.height - size,
            width: size,
            height: size,
          },
          { animate: { duration: 0 } },
        ),
      )
    }

    entry.view.setVisible(visible)
    entry.corners.forEach((corner) => corner.setVisible(visible && !!entry.cornerKey))

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
      const corners = [new ImageView(), new ImageView()]
      view.setVisible(false)
      window.contentView.addChildView(view)
      corners.forEach((corner) => {
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
