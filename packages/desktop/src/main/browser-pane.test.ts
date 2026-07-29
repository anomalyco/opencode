import { afterAll, expect, mock, test } from "bun:test"

let windowDestroyed = false
let contentsDestroyed = false
let removed = 0
let detached = 0
let contentsClosed = 0
let registrationClosed = 0
let attachmentClosed = 0

class WebContentsView {
  readonly webContents = {
    session: {},
    debugger: {},
    setWindowOpenHandler() {},
    on() {},
    isDestroyed: () => contentsDestroyed,
    close: () => contentsClosed++,
  }
  setVisible() {}
  setBounds() {}
  getBounds() {
    return { x: 0, y: 0, width: 800, height: 600 }
  }
}

mock.module("electron", () => ({ default: {}, BrowserWindow: class {}, WebContentsView }))
mock.module("@opencode-ai/client/node", () => ({
  BrowserDriver: { chromium: () => ({}) },
  OpenCode: {
    make: () => ({
      browser: {
        register: async () => ({
          attach: async () => ({ close: async () => attachmentClosed++ }),
          close: async () => registrationClosed++,
        }),
      },
    }),
  },
}))
afterAll(() => mock.restore())

test("cleans up registration after Electron already destroyed its owned objects", async () => {
  windowDestroyed = false
  contentsDestroyed = false
  removed = 0
  detached = 0
  contentsClosed = 0
  registrationClosed = 0
  attachmentClosed = 0
  const pane = (await import(`./browser-pane?destroyed=${Date.now()}`)).createBrowserPane()
  const win = {
    isDestroyed: () => windowDestroyed,
    once() {},
    off: () => detached++,
    webContents: { send() {} },
    contentView: {
      addChildView() {},
      removeChildView: () => removed++,
      getBounds: () => ({ x: 0, y: 0, width: 800, height: 600 }),
    },
  }

  await pane.register(win, {
    sessionID: "ses_desktop_browser",
    bindingID: "binding",
    endpoint: { url: "http://127.0.0.1:4096" },
  })
  pane.setLayout(win, {
    bindingID: "binding",
    layout: { visible: true, bounds: { x: 0, y: 0, width: 800, height: 600 } },
  })
  await Promise.resolve()
  windowDestroyed = true
  contentsDestroyed = true

  await pane.unregister(win, "binding")
  await Promise.resolve()
  expect({ detached, removed, contentsClosed, registrationClosed, attachmentClosed }).toEqual({
    detached: 0,
    removed: 0,
    contentsClosed: 0,
    registrationClosed: 1,
    attachmentClosed: 1,
  })
})
