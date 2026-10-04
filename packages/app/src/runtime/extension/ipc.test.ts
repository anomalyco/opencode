import { expect, test } from "bun:test"
import type { Ipc } from "@opencode/gui-extensions/sdk"
import type { Bridge, BridgeMessage } from "@opencode/gui-extensions/sdk/bridge"
import { createIpcClients } from "./ipc"

const token: Ipc = { kind: "ipc", id: "fixture", spec: { id: "fixture", methods: {} } }

type Reply = { readonly available: boolean; readonly state?: unknown }

// Each row sends an event while the subscribe reply is in flight; the older reply must not undo it.
test.each<[string, BridgeMessage, Reply, { available: boolean; state: unknown }]>([
  [
    "the Ipc appearing",
    { type: "available", ipc: "fixture", available: true },
    { available: false },
    { available: true, state: undefined },
  ],
  [
    "the Ipc going away",
    { type: "available", ipc: "fixture", available: false },
    { available: true, state: { count: 1 } },
    { available: false, state: undefined },
  ],
  [
    "a state push",
    { type: "state", ipc: "fixture", state: { count: 2 } },
    { available: true, state: { count: 1 } },
    { available: true, state: { count: 2 } },
  ],
])("a subscribe reply older than %s keeps the event's data", async (_, event, reply, expected) => {
  const bridge = fakeBridge()
  const ipcs = createIpcClients(bridge.value)
  expect(ipcs.client(token)).toBeUndefined()
  bridge.emit(event)
  bridge.reply(reply)
  await Bun.sleep(0)
  const client = ipcs.client(token)
  expect({ available: !!client, state: client?.state() }).toEqual(expected)
  ipcs.dispose()
})

function fakeBridge() {
  const listeners = new Set<(message: BridgeMessage) => void>()
  const pending = Promise.withResolvers<Reply>()

  const value: Bridge = {
    packaged: false,
    call: () => Promise.reject(new Error("no calls in this test")),
    subscribe: () => pending.promise,
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
    manager: {
      list: async () => [],
      enable: async () => {},
      disable: async () => {},
      reload: async () => {},
      install: async () => {},
      remove: async () => {},
      source: async () => "",
      asset: () => "",
    },
  }

  return {
    value,
    emit: (message: BridgeMessage) => listeners.forEach((listener) => listener(message)),
    reply: (reply: Reply) => pending.resolve(reply),
  }
}
