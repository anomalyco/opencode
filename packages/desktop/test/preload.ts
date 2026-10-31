import { mock } from "bun:test"

// The main process imports Electron everywhere, and outside Electron the real module is only a path
// string, so tests stub the API surface they touch. `userData` and `handlers` are mutable: a test
// points the storage layer at its own directory and observes the handlers it registers.
export const electron = {
  userData: "",
  handlers: new Map<string, (event: unknown, names: unknown) => unknown>(),
  app: {
    getPath: () => electron.userData,
    on: () => {},
    off: () => {},
  },
  BrowserWindow: { getAllWindows: () => [] },
  protocol: {},
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, names: unknown) => unknown) => {
      electron.handlers.set(channel, handler)
    },
  },
}

mock.module("electron", () => ({ ...electron, default: electron }))
