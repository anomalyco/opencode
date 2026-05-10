import { beforeEach, describe, expect, mock, test } from "bun:test"

const handledChannels: string[] = []
const onChannels: string[] = []

mock.module("electron", () => ({
  BrowserWindow: {
    getAllWindows: () => [],
    fromWebContents: () => null,
  },
  Notification: class {
    show() {}
  },
  app: {
    exit() {},
    relaunch() {},
  },
  clipboard: {
    readImage: () => ({
      isEmpty: () => true,
    }),
  },
  dialog: {
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    showSaveDialog: async () => ({ canceled: true, filePath: undefined }),
  },
  ipcMain: {
    handle(channel: string) {
      handledChannels.push(channel)
    },
    on(channel: string) {
      onChannels.push(channel)
    },
  },
  shell: {
    openExternal() {},
    openPath: async () => "",
  },
  WebContentsView: class {},
  session: {
    fromPartition() {
      return {
        clearCache: async () => {},
      }
    },
  },
}))

mock.module("./store", () => ({
  getStore() {
    return {
      store: {},
      get() {
        return null
      },
      set() {},
      delete() {},
      clear() {},
    }
  },
}))

mock.module("./windows", () => ({
  setTitlebar() {},
  updateTitlebar() {},
}))

const { registerIpcHandlers } = await import("./ipc")

describe("registerIpcHandlers", () => {
  beforeEach(() => {
    handledChannels.length = 0
    onChannels.length = 0
  })

  test("registers browser ipc handlers alongside existing handlers", () => {
    registerIpcHandlers({
      killSidecar() {},
      awaitInitialization: async () => ({ url: "", username: null, password: null }),
      getWindowConfig: () => ({ updaterEnabled: false }),
      consumeInitialDeepLinks: () => [],
      getDefaultServerUrl: () => null,
      setDefaultServerUrl() {},
      getWslConfig: async () => ({ enabled: false }),
      setWslConfig() {},
      getDisplayBackend: async () => null,
      setDisplayBackend() {},
      parseMarkdown: () => "",
      checkAppExists: () => false,
      wslPath: async () => "",
      resolveAppPath: async () => null,
      loadingWindowComplete() {},
      runUpdater() {},
      checkUpdate: async () => ({ updateAvailable: false }),
      installUpdate() {},
      setBackgroundColor() {},
    })

    registerIpcHandlers({
      killSidecar() {},
      awaitInitialization: async () => ({ url: "", username: null, password: null }),
      getWindowConfig: () => ({ updaterEnabled: false }),
      consumeInitialDeepLinks: () => [],
      getDefaultServerUrl: () => null,
      setDefaultServerUrl() {},
      getWslConfig: async () => ({ enabled: false }),
      setWslConfig() {},
      getDisplayBackend: async () => null,
      setDisplayBackend() {},
      parseMarkdown: () => "",
      checkAppExists: () => false,
      wslPath: async () => "",
      resolveAppPath: async () => null,
      loadingWindowComplete() {},
      runUpdater() {},
      checkUpdate: async () => ({ updateAvailable: false }),
      installUpdate() {},
      setBackgroundColor() {},
    })

    expect(onChannels.filter((channel) => channel === "browser-attach")).toHaveLength(1)
    expect(onChannels.filter((channel) => channel === "browser-set-bounds")).toHaveLength(1)
    expect(onChannels.filter((channel) => channel === "browser-show")).toHaveLength(1)
    expect(onChannels.filter((channel) => channel === "browser-hide")).toHaveLength(1)
    expect(handledChannels.filter((channel) => channel === "browser-open")).toHaveLength(1)
    expect(handledChannels.filter((channel) => channel === "browser-navigate")).toHaveLength(1)
    expect(handledChannels.filter((channel) => channel === "browser-back")).toHaveLength(1)
    expect(handledChannels.filter((channel) => channel === "browser-forward")).toHaveLength(1)
    expect(handledChannels.filter((channel) => channel === "browser-reload")).toHaveLength(1)
    expect(handledChannels.filter((channel) => channel === "browser-clear-data")).toHaveLength(1)
    expect(handledChannels.filter((channel) => channel === "browser-state")).toHaveLength(1)
    expect(handledChannels.filter((channel) => channel === "browser-screenshot")).toHaveLength(1)
    expect(handledChannels.filter((channel) => channel === "browser-annotation-get-detail")).toHaveLength(1)
    expect(handledChannels.filter((channel) => channel === "browser-store-annotation-detail")).toHaveLength(1)
    expect(handledChannels).toContain("kill-sidecar")
    expect(onChannels).toContain("loading-window-complete")
  })
})
