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
 * button. It takes focus as it opens and gives it back to the window when it closes. It closes when it loses focus,
 * when the window's own page takes focus back, on Escape in either, when its window loses focus, moves, resizes or
 * closes, when the tab it is about leaves the screen or closes, and when another popup opens. Links it opens become
 * tabs of the pane.
 */
export function createPopups(input: { partition: string; tabs: ExtensionTabs }) {
  // Where each window's extensions button is, from the click that opens a popup.
  const anchors = new Map<number, Rectangle>()
  const current: OpenPopup = {}

  const close = () => current.close?.()

  return {
    /** Remembers where `window`'s extensions button is, in the window's content coordinates. */
    anchor(window: BrowserWindow, anchor: Rectangle) {
      const id = window.id

      if (!anchors.has(id)) window.once("closed", () => anchors.delete(id))
      anchors.set(id, anchor)
    },
    /** Opens `url` over `window`; only a page of `extension`'s own package opens, as in Chrome. */
    open(window: BrowserWindow, extension: string, url: string) {
      if (!URL.canParse(url) || new URL(url).protocol !== "chrome-extension:" || new URL(url).host !== extension) return
      close()
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

      // The window's page, which has focus until the popup takes it, and gets it back when the popup closes.
      const page = window.webContents

      const escape = (event: Electron.Event, key: Electron.Input) => {
        if (key.type !== "keyDown" || key.key !== "Escape") return
        event.preventDefault()
        dismiss()
      }

      // Escape in the window's page also closes a popup that has not taken focus yet; the page keeps the key.
      const pageEscape = (_event: Electron.Event, key: Electron.Input) => {
        if (key.type === "keyDown" && key.key === "Escape") dismiss()
      }

      const dismiss = () => {
        if (current.close !== dismiss) return
        current.close = undefined
        const focused = !contents.isDestroyed() && contents.isFocused()
        release()
        leave()
        window.off("blur", dismiss)
        window.off("resize", dismiss)
        window.off("move", dismiss)
        window.off("closed", dismiss)

        if (!page.isDestroyed()) {
          page.off("focus", dismiss)
          page.off("before-input-event", pageEscape)
        }

        if (!window.isDestroyed()) window.contentView.removeChildView(view)

        if (!contents.isDestroyed()) contents.close()

        if (focused && !page.isDestroyed()) page.focus()
      }

      current.close = dismiss
      place(POPUP_MIN)
      view.setBackgroundColor("#ffffff")
      // Last, so it sits above the pane's pages.
      window.contentView.addChildView(view)
      window.on("blur", dismiss)
      window.on("resize", dismiss)
      window.on("move", dismiss)
      window.once("closed", dismiss)
      contents.on("preferred-size-changed", (_event, size) => place(size))
      contents.on("blur", dismiss)
      contents.on("destroyed", dismiss)
      contents.on("before-input-event", escape)
      page.on("before-input-event", pageEscape)

      // The popup stays on its extension's pages; anything else opens as a pane tab, as Chrome opens it in a tab.
      contents.on("will-navigate", (event) => {
        if (URL.canParse(event.url) && new URL(event.url).host === extension) return
        event.preventDefault()
        void openTab(window, event.url, dismiss)
      })

      contents.setWindowOpenHandler((details) => {
        void openTab(window, details.url, dismiss)

        return { action: "deny" }
      })

      // Focus at once, so keys reach the popup while it loads; once it has it, the user going back to the window's
      // page closes it. Loading can move focus within the view, so it is given again when the page is ready.
      contents.focus()
      page.on("focus", dismiss)
      contents.once("did-finish-load", () => {
        if (current.close === dismiss && !contents.isDestroyed() && !page.isFocused()) contents.focus()
      })
      void contents.loadURL(url).catch(dismiss)
    },
    close,
  }

  async function openTab(window: BrowserWindow, url: string, dismiss: () => void) {
    const tab = input.tabs.activeTab(window)
    const anchor = tab ? input.tabs.get(tab.id) : undefined
    await anchor?.open(url, true).catch(() => undefined)
    dismiss()
  }
}
