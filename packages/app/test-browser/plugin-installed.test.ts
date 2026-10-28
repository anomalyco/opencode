import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import type { Bridge, BridgeMessage, Installed } from "@opencode/plugin/gui/host"
import { createInstalled } from "../src/runtime/plugin/installed"

test("a list main pushes while the initial list is pending wins over the older reply", async () => {
  const listeners = new Set<(message: BridgeMessage) => void>()
  const reply = Promise.withResolvers<readonly Installed[]>()

  const bridge: Bridge = {
    packaged: false,
    call: () => Promise.reject(new Error("no calls in this test")),
    subscribe: async () => ({ available: false }),
    on: (listener) => {
      listeners.add(listener)

      return () => {
        listeners.delete(listener)
      }
    },
    embed: () => {},
    capture: async () => undefined,
    runMenubarItem: () => {},
    configure: () => {},
    pluginGuis: async () => ({ plugins: [], reserved: [] }),
    manager: {
      list: () => reply.promise,
      enable: async () => {},
      disable: async () => {},
      reload: async () => {},
    },
  }

  const plugin = { id: "fixture", builtin: false }
  const root = createRoot((dispose) => ({ installed: createInstalled(bridge), dispose }))
  // Another window disabled the plugin before this window's initial list arrived.
  listeners.forEach((listener) => listener({ type: "installed", list: [{ ...plugin, enabled: false }] }))
  reply.resolve([{ ...plugin, enabled: true }])
  await Bun.sleep(0)
  expect({
    known: root.installed.enableState() !== undefined,
    enabled: root.installed.list().map((item) => item.enabled),
  }).toEqual({
    known: true,
    enabled: [false],
  })
  root.dispose()
})
