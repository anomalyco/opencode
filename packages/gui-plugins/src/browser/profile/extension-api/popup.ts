import electron, { type BrowserWindow, type Rectangle } from "electron"
import type { ExtensionTabs } from "./tabs"

/** Chrome's limits for a popup's size, in pixels. */
const POPUP_MIN = { width: 25, height: 25 }

const POPUP_MAX = { width: 800, height: 600 }

/**
 * Where a popup belongs in its window's content, in device-independent pixels. The window reports `anchor`, the
 * extensions button, and `top`, the top edge of the page area under the toolbar and its bars; neither is trusted
 * (`popupBounds`). `pageTop` is main's own: the top edge of the tab's page view while the page fills the page area,
 * absent with a device viewport, whose page sits lower than the area's top. `rtl`: the toolbar runs right to left, so
 * the button is at its left end.
 */
export type PopupPlacement = {
  readonly anchor: Rectangle
  readonly top: number
  readonly pageTop?: number
  readonly rtl?: boolean
}

/**
 * Where a popup goes in its window's content: its top edge on the page area's, and the edge at the end of the toolbar
 * on its button's (the right edge, or the left one in a right-to-left layout), at the size its page asks for within
 * Chrome's limits, moved sideways or up to stay inside the content.
 *
 * The window's numbers only ever lower the popup. A number that is not finite counts as missing, the button is taken
 * as inside the content, and the popup never starts above the bottom edge of its button, nor above the top of the page
 * view main knows. So nothing the window reports puts it over the app's own bars.
 */
export function popupBounds(
  placement: PopupPlacement,
  size: { width: number; height: number },
  content: { width: number; height: number },
) {
  const whole = (value: number, low: number, high: number) => Math.min(Math.max(Number.isFinite(value) ? Math.round(value) : low, low), Math.max(high, low))
  const width = whole(size.width, POPUP_MIN.width, Math.min(POPUP_MAX.width, content.width))
  const height = whole(size.height, POPUP_MIN.height, Math.min(POPUP_MAX.height, content.height))
  const left = whole(placement.anchor.x, 0, content.width)
  const right = whole(placement.anchor.x + placement.anchor.width, left, content.width)
  const floor = Math.max(whole(placement.anchor.y + placement.anchor.height, 0, content.height), whole(placement.pageTop ?? 0, 0, content.height))
  // One that would not fit below moves up, as far as the floor, and is cut short at the window's bottom edge after that.
  const y = Math.max(Math.min(whole(placement.top, floor, content.height), content.height - height), floor)

  return { x: whole(placement.rtl ? left : right - width, 0, content.width - width), y, width, height: Math.max(Math.min(height, content.height - y), 0) }
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
  // Where each window's extensions button and page area are, from the click that opens a popup.
  const anchors = new Map<number, PopupPlacement>()
  const current: OpenPopup = {}

  const close = () => current.close?.()

  return {
    /** Remembers where `window`'s extensions button and page area are, in the window's content coordinates. */
    anchor(window: BrowserWindow, placement: PopupPlacement) {
      const id = window.id

      if (!anchors.has(id)) window.once("closed", () => anchors.delete(id))
      anchors.set(id, placement)
    },
    /** Opens `url` over `window`; only a page of `extension`'s own package opens, as in Chrome. */
    open(window: BrowserWindow, extension: string, url: string) {
      if (!URL.canParse(url) || new URL(url).protocol !== "chrome-extension:" || new URL(url).host !== extension) return
      close()
      const content = window.getContentBounds()
      // A popup an extension opens before any click in this window has no reported place: the window's top right corner.
      const placement = anchors.get(window.id) ?? { anchor: { x: content.width - 40, y: 0, width: 32, height: 32 }, top: 32 }

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
      const leave = input.tabs.watchPopupTab(window.id, about, () => dismiss())

      const place = (size: { width: number; height: number }) => {
        if (!window.isDestroyed()) view.setBounds(popupBounds(placement, size, window.getContentBounds()))
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

        // The view stays in the window until its web contents is gone. Taken out earlier, and always when the page
        // closed itself (uBlock Origin's element picker does), which reaches here from inside the destruction,
        // Electron 44 detaches the page's native view with no window left and its main process crashes on macOS.
        const remove = () =>
          setImmediate(() => {
            if (!window.isDestroyed()) window.contentView.removeChildView(view)
          })

        if (contents.isDestroyed()) remove()

        if (!contents.isDestroyed()) {
          view.setVisible(false)
          contents.once("destroyed", remove)
          contents.close()
        }

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
        if (URL.parse(event.url)?.protocol === "chrome-extension:" && new URL(event.url).host === extension) return
        event.preventDefault()
        void openTab(window, event.url, extension, dismiss)
      })

      contents.setWindowOpenHandler((details) => {
        void openTab(window, details.url, extension, dismiss)

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

  async function openTab(window: BrowserWindow, url: string, extension: string, dismiss: () => void) {
    const tab = input.tabs.activeTab(window)
    const anchor = tab ? input.tabs.get(tab.id) : undefined
    await anchor?.open(url, true, extension).catch(() => undefined)
    dismiss()
  }
}
