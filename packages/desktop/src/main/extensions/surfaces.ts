import { ImageView, screen, type BrowserWindow, type View } from "electron"
import type { DesktopExtension } from "@opencode/plugin/desktop/protocol"
import { createCornerImages } from "../native/corners"

export function createSurfaces(win: BrowserWindow) {
  const entries = new Map<string, { extensionID: string; view: View; corners: ImageView[]; key: string }>()
  const remove = (id: string) => {
    const entry = entries.get(id)
    if (!entry) return
    entries.delete(id)
    if (win.isDestroyed()) return
    entry.view.setVisible(false)
    entry.corners.forEach((corner) => win.contentView.removeChildView(corner))
    win.contentView.removeChildView(entry.view)
  }
  return {
    register(extensionID: string, view: View) {
      const id = crypto.randomUUID()
      view.setBounds({ x: 0, y: 0, width: 1000, height: 700 })
      view.setVisible(false)
      win.contentView.addChildView(view)
      const corners = [new ImageView(), new ImageView()]
      corners.forEach((corner) => {
        corner.setVisible(false)
        win.contentView.addChildView(corner)
      })
      entries.set(id, { extensionID, view, corners, key: "" })
      return { id, dispose: () => remove(id) }
    },
    layout(extensionID: string, id: string, layout?: DesktopExtension.Layout) {
      const entry = entries.get(id)
      if (!entry || entry.extensionID !== extensionID || win.isDestroyed()) return
      const bounds = layout?.bounds
      if (!layout?.visible || !bounds || bounds.width <= 0 || bounds.height <= 0) {
        entry.view.setVisible(false)
        entry.corners.forEach((corner) => corner.setVisible(false))
        return
      }
      entry.view.setBounds(bounds)
      const size = Math.min(layout.radius ?? 10, Math.floor(bounds.width / 2), Math.floor(bounds.height / 2))
      const scale = screen.getDisplayMatching(win.getBounds()).scaleFactor
      const key = layout.background && size > 0 ? `${layout.background}:${size}:${scale}` : ""
      if (key && key !== entry.key && layout.background)
        createCornerImages(layout.background, size, scale).forEach((image, index) =>
          entry.corners[index].setImage(image),
        )
      entry.key = key
      entry.corners.forEach((corner, index) => {
        corner.setBounds(
          {
            x: bounds.x + (index ? bounds.width - size : 0),
            y: bounds.y + bounds.height - size,
            width: size,
            height: size,
          },
          { animate: { duration: 0 } },
        )
        corner.setVisible(!!key)
      })
      entry.view.setVisible(true)
    },
    release(extensionID: string) {
      entries.forEach((entry, id) => {
        if (entry.extensionID === extensionID) remove(id)
      })
    },
    dispose() {
      Array.from(entries.keys()).forEach(remove)
    },
  }
}
