import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import type { Bridge, BridgeMessage, Installed } from "@opencode/gui-extensions/sdk/bridge"
import { createInstalled } from "../src/runtime/extension/installed"

test("a list main pushes while the initial list is pending wins over the older reply", async () => {
  const listeners = new Set<(message: BridgeMessage) => void>()
  const reply = Promise.withResolvers<readonly Installed[]>()
  const bridge: Bridge = {
    call: () => Promise.reject(new Error("no calls in this test")),
    subscribe: async () => ({ available: false }),
    on: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    surface: () => {},
    capture: async () => undefined,
    menubar: () => {},
    configure: () => {},
    manager: {
      list: () => reply.promise,
      enable: async () => {},
      disable: async () => {},
      reload: async () => {},
      install: async () => {},
      remove: async () => {},
      source: async () => "",
      asset: () => "",
    },
  }
  const extension = { id: "fixture", name: "Fixture", version: "1.0.0", builtin: true }
  const root = createRoot((dispose) => ({ installed: createInstalled(bridge), dispose }))
  // Another window disabled the extension before this window's initial list arrived.
  listeners.forEach((listener) => listener({ type: "extensions", list: [{ ...extension, enabled: false }] }))
  reply.resolve([{ ...extension, enabled: true }])
  await Bun.sleep(0)
  expect({ loaded: root.installed.loaded(), enabled: root.installed.list().map((item) => item.enabled) }).toEqual({
    loaded: true,
    enabled: [false],
  })
  root.dispose()
})
