import { expect, mock, test } from "bun:test"

const exposed: { key: string; value: unknown }[] = []

mock.module("electron", () => ({
  contextBridge: {
    exposeInMainWorld(key: string, value: unknown) {
      exposed.push({ key, value })
    },
  },
  ipcRenderer: {
    invoke: () => Promise.resolve(undefined),
    on() {},
    removeListener() {},
    send() {},
  },
}))

test("exposes browser API under window.api", async () => {
  exposed.length = 0

  await import("./index")

  expect(exposed).toHaveLength(1)
  expect(exposed[0]?.key).toBe("api")
  expect(exposed[0]?.value).toMatchObject({
    browser: {
      attach: expect.any(Function),
      back: expect.any(Function),
      clearData: expect.any(Function),
      forward: expect.any(Function),
      getState: expect.any(Function),
      hide: expect.any(Function),
      navigate: expect.any(Function),
      onOpenRequested: expect.any(Function),
      open: expect.any(Function),
      reload: expect.any(Function),
      screenshot: expect.any(Function),
      setBounds: expect.any(Function),
      show: expect.any(Function),
      storeAnnotationDetail: expect.any(Function),
      toolGetAnnotationDetail: expect.any(Function),
    },
  })
})
