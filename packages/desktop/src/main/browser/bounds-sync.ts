import type { BrowserWindow, Rectangle, WebContentsView } from "electron"

export function syncViewBounds(_win: BrowserWindow, view: WebContentsView, bounds: Rectangle) {
  view.setBounds(bounds)
  view.setVisible(true)
}

export function attachAndShow(win: BrowserWindow, view: WebContentsView, bounds: Rectangle) {
  if (!win.contentView.children.includes(view)) {
    win.contentView.addChildView(view)
  }
  syncViewBounds(win, view, bounds)
}
