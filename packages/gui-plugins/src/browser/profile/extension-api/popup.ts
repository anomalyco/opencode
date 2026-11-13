import electron, { type BrowserWindow, type Rectangle } from "electron"
import type { ExtensionTabs } from "./tabs"

/** Chrome's limits for a popup's size, in pixels. */
export const POPUP_MIN = { width: 25, height: 25 }

export const POPUP_MAX = { width: 800, height: 600 }

/**
 * Where a popup goes in its window's content: under its anchor, its right edge on the anchor's, at the size its page
 * asks for within Chrome's limits, moved left or up to stay inside the content.
 */
export function popupBounds(
  anchor: Rectangle,
  size: { width: number; height: number },
  content: { width: number; height: number },
) {
  const width = Math.min(Math.max(Math.round(size.width), POPUP_MIN.width), POPUP_MAX.width, content.width)
  const height = Math.min(Math.max(Math.round(size.height), POPUP_MIN.height), POPUP_MAX.height, content.height)
  const x = Math.min(Math.max(anchor.x + anchor.width - width, 0), content.width - width)
  const below = anchor.y + anchor.height + 4
  const y = below + height <= content.height ? below : Math.max(content.height - height, 0)

  return { x: Math.round(x), y: Math.round(y), width, height }
}

/** How to close the popup that is open, while one is. */
type OpenPopup = { close?: () => void }

/**
 * The one extension popup open at a time: a page of the extension in a view over the window, under the extensions
 * button. It closes when it loses focus, on Escape, when its window loses focus, moves or resizes, when the tab it is
 * about leaves the screen, and when another popup opens. Links it opens become tabs of the pane.
 */
export function createPopups(input: { partition: string; tabs: ExtensionTabs }) {
  // The extensions button each window opened a popup from last, so `action.openPopup` opens one there too.
  const anchors = new Map<number, Rectangle>()
  const current: OpenPopup = {}

  const close = () => current.close?.()

  return {
    /** Remembers where `window`'s extensions button is, in the window's content coordinates. */
    anchor(window: BrowserWindow, anchor: Rectangle) {
      anchors.set(window.id, anchor)
    },
    open(window: BrowserWindow, url: string) {
      close()
      const extension = new URL(url).host
      const content = window.getContentBounds()
      const anchor = anchors.get(window.id) ?? { x: content.width - 40, y: 0, width: 32, height: 32 }

      const view = new electron.WebContentsView({
        webPreferences: {
          partition: input.partition,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webviewTag: false,
          devTools: false,
          enablePreferredSizeMode: true,
        },
      })

      const contents = view.webContents
      const release = input.tabs.popup(contents, window)
      const about = input.tabs.activeTab(window)?.id

      // The popup is about the tab under it; once another tab or a preview takes its place, it would show a stale tab.
      const leave = input.tabs.onHidden((id) => {
        if (id === about) dismiss()
      })

      const place = (size: { width: number; height: number }) => {
        if (!window.isDestroyed()) view.setBounds(popupBounds(anchor, size, window.getContentBounds()))
      }

      const dismiss = () => {
        if (current.close !== dismiss) return
        current.close = undefined
        release()
        leave()
        window.off("blur", dismiss)
        window.off("resize", dismiss)
        window.off("move", dismiss)

        if (!window.isDestroyed()) window.contentView.removeChildView(view)

        if (!contents.isDestroyed()) contents.close()
      }

      current.close = dismiss
      place(POPUP_MIN)
      view.setBackgroundColor("#ffffff")
      // Last, so it sits above the pane's pages.
      window.contentView.addChildView(view)
      window.on("blur", dismiss)
      window.on("resize", dismiss)
      window.on("move", dismiss)
      contents.on("preferred-size-changed", (_event, size) => place(size))
      contents.on("blur", dismiss)
      contents.on("destroyed", dismiss)

      contents.on("before-input-event", (event, key) => {
        if (key.type !== "keyDown" || key.key !== "Escape") return
        event.preventDefault()
        dismiss()
      })

      // The popup stays on its extension's pages; anything else opens as a pane tab, as Chrome opens it in a tab.
      contents.on("will-navigate", (event) => {
        if (URL.canParse(event.url) && new URL(event.url).host === extension) return
        event.preventDefault()
        void openTab(window, event.url)
      })

      contents.setWindowOpenHandler((details) => {
        void openTab(window, details.url)

        return { action: "deny" }
      })

      contents.once("did-finish-load", () => contents.focus())
      void contents.loadURL(url).catch(dismiss)
    },
    close,
  }

  async function openTab(window: BrowserWindow, url: string) {
    const tab = input.tabs.activeTab(window)
    const anchor = tab ? input.tabs.get(tab.id) : undefined
    await anchor?.open(url, true).catch(() => undefined)
    close()
  }
}
