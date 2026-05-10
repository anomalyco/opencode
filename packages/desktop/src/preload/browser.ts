import type { BrowserAPI } from "./types"

type BrowserIpcRenderer = {
  invoke: <T>(channel: string, ...args: unknown[]) => Promise<T>
  on: (channel: string, listener: (...args: unknown[]) => void) => void
  removeListener: (channel: string, listener: (...args: unknown[]) => void) => void
  send: (channel: string, ...args: unknown[]) => void
}

export function createBrowserApi(renderer: BrowserIpcRenderer): BrowserAPI {
  return {
    setBounds: (bounds, browserId) => renderer.send("browser-set-bounds", bounds, browserId),
    show: (browserId) => renderer.send("browser-show", browserId ? { browserId } : undefined),
    hide: (browserId) => renderer.send("browser-hide", browserId ? { browserId } : undefined),
    attach: (browserId) => renderer.send("browser-attach", browserId ? { browserId } : undefined),
    setActiveBrowser: (browserId) => renderer.invoke("browser-activate", { browserId }),
    createBrowser: (params) => renderer.invoke("browser-create", params),
    closeBrowser: (browserId) => renderer.invoke("browser-close", { browserId }),
    open: () => renderer.invoke("browser-open"),
    onOpenRequested: (cb) => {
      const listener = () => cb()
      renderer.on("browser-open-requested", listener)
      return () => renderer.removeListener("browser-open-requested", listener)
    },
    navigate: (url) => renderer.invoke("browser-navigate", url),
    back: () => renderer.invoke("browser-back"),
    forward: () => renderer.invoke("browser-forward"),
    reload: () => renderer.invoke("browser-reload"),
    clearData: () => renderer.invoke("browser-clear-data"),
    clearAnnotationMarkers: () => renderer.invoke("browser-annotation-markers-clear"),
    getConsoleMessages: (params) => (params ? renderer.invoke("browser-console-messages", params) : renderer.invoke("browser-console-messages")),
    clearConsoleMessages: (params) => (params ? renderer.invoke("browser-console-clear", params) : renderer.invoke("browser-console-clear")),
    getState: () => renderer.invoke("browser-state"),
    screenshot: () => renderer.invoke("browser-screenshot"),
    startInspectMode: () => renderer.invoke("browser-inspect-start"),
    stopInspectMode: () => renderer.invoke("browser-inspect-stop"),
    getAnnotationData: (selector) => renderer.invoke("browser-get-annotation-data", selector),
    toolClick: (selector) => renderer.invoke("browser-click", selector),
    toolOpenBrowserPage: (browserId) => (browserId ? renderer.invoke("browser-open", { browserId }) : renderer.invoke("browser-open")),
    toolNavigatePage: (url, browserId) => renderer.invoke("browser-navigate", browserId ? { url, browserId } : url),
    toolReadPage: (browserId) => (browserId ? renderer.invoke("browser-get-snapshot", { browserId }) : renderer.invoke("browser-get-snapshot")),
    toolScreenshotPage: (browserId) => (browserId ? renderer.invoke("browser-screenshot", { browserId }) : renderer.invoke("browser-screenshot")),
    toolClickElement: (selector, browserId) => renderer.invoke("browser-click", browserId ? { selector, browserId } : selector),
    toolConsoleMessages: (params) => (params ? renderer.invoke("browser-console-messages", params) : renderer.invoke("browser-console-messages")),
    toolConsoleClear: (params) => (params ? renderer.invoke("browser-console-clear", params) : renderer.invoke("browser-console-clear")),
    toolTypeInPage: (selector, text, browserId) =>
      browserId ? renderer.invoke("browser-type", { selector, text, browserId }) : renderer.invoke("browser-type", selector, text),
    toolHover: (selector, browserId) => renderer.invoke("browser-hover", browserId ? { selector, browserId } : selector),
    toolDrag: (selector, targetSelector, browserId) =>
      browserId
        ? renderer.invoke("browser-drag", { selector, targetSelector, browserId })
        : renderer.invoke("browser-drag", selector, targetSelector),
    toolHandleDialog: (action, promptText, browserId) =>
      renderer.invoke("browser-handle-dialog", {
        action,
        ...(promptText === undefined ? {} : { promptText }),
        ...(browserId ? { browserId } : {}),
      }),
    toolRunBrowserCode: (code, browserId) =>
      browserId ? renderer.invoke("browser-run-code", { code, browserId }) : renderer.invoke("browser-run-code", code),
    toolRunPlaywrightCode: (code, browserId) =>
      browserId
        ? renderer.invoke("browser-run-playwright-code", { code, browserId })
        : renderer.invoke("browser-run-playwright-code", code),
    toolType: (selector, text) => renderer.invoke("browser-type", selector, text),
    toolPress: (key) => renderer.invoke("browser-press", key),
    toolUploadFile: (selector, fileRef, workspaceRoot) =>
      renderer.invoke("browser-upload-file", selector, fileRef, workspaceRoot),
    toolListDownloads: () => renderer.invoke("browser-downloads-list"),
    toolGetAnnotationDetail: (id) => renderer.invoke("browser-annotation-get-detail", id),
    storeAnnotationDetail: (id, detail) => renderer.invoke("browser-store-annotation-detail", id, detail),
    toolInspect: ((selector?: string) => renderer.invoke("browser-inspect", selector)) as BrowserAPI["toolInspect"],
    toolGetSnapshot: () => renderer.invoke("browser-get-snapshot"),
  }
}
