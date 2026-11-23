import { expect, test } from "bun:test"
import { Ipc } from "@opencode/plugin/gui"
import { Schema } from "effect"
import type { Bridge, BridgeMessage } from "@opencode/plugin/gui/host"
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

test("no-input methods pass their first argument's abort signal to the bridge", async () => {
  const bridge = fakeBridge()
  const controller = new AbortController()
  const calls: { method: string; input?: unknown; signal?: AbortSignal }[] = []

  const methods = Ipc.define({
    id: "fixture",
    methods: { info: { output: Schema.String }, echo: { input: Schema.String, output: Schema.String } },
  })

  const ipcs = createIpcClients({
    ...bridge.value,
    call: async (request, signal) => {
      calls.push({ method: request.method, input: request.input, signal })

      return "reply"
    },
  })

  ipcs.typed(methods)
  bridge.emit({ type: "available", ipc: "fixture", available: true })
  const client = ipcs.typed(methods)

  expect(await client?.info({ signal: controller.signal })).toBe("reply")
  expect(await client?.echo("input", { signal: controller.signal })).toBe("reply")
  expect(calls).toEqual([
    { method: "info", input: null, signal: controller.signal },
    { method: "echo", input: "input", signal: controller.signal },
  ])
  ipcs.dispose()
})

test("a subscribe main rejects fails the Ipc until main provides it again", async () => {
  const bridge = fakeBridge()
  const ipcs = createIpcClients(bridge.value)
  ipcs.client(token)
  bridge.fail(new Error("main is busy"))
  await Bun.sleep(0)
  const failed = { failed: ipcs.failed(token), client: ipcs.client(token), subscribes: bridge.subscribes() }
  bridge.emit({ type: "available", ipc: "fixture", available: true })
  bridge.reply({ available: true, state: { count: 1 } })
  await Bun.sleep(0)

  expect(failed).toEqual({ failed: true, client: undefined, subscribes: 1 })
  expect({ failed: ipcs.failed(token), state: ipcs.client(token)?.state(), subscribes: bridge.subscribes() }).toEqual({
    failed: false,
    state: { count: 1 },
    subscribes: 2,
  })
  ipcs.dispose()
})

test("a payload its codec rejects reaches no reader and does not stop the bridge's other listeners", async () => {
  const bridge = fakeBridge()
  const Counter = Ipc.define({ id: "fixture", methods: {}, state: Schema.Struct({ count: Schema.Number }) })
  const ipcs = createIpcClients(bridge.value)
  const seen: string[] = []
  ipcs.typed(Counter)
  bridge.value.on((message) => void seen.push(message.type))
  bridge.reply({ available: true, state: { count: 1 } })
  await Bun.sleep(0)
  bridge.emit({ type: "state", ipc: "fixture", state: { count: "many" } })

  expect({ seen, state: ipcs.typed(Counter)?.state() }).toEqual({ seen: ["state"], state: { count: 1 } })
  ipcs.dispose()
})

test("a subscribe reply that lands after dispose changes nothing", async () => {
  const bridge = fakeBridge()
  const ipcs = createIpcClients(bridge.value)
  ipcs.client(token)
  ipcs.dispose()
  bridge.reply({ available: true })
  await Bun.sleep(0)

  expect({ client: ipcs.client(token), generation: ipcs.generation(token) }).toEqual({
    client: undefined,
    generation: 0,
  })
})

function fakeBridge() {
  const listeners = new Set<(message: BridgeMessage) => void>()
  // One reply per subscribe, answered in order.
  const replies: PromiseWithResolvers<Reply>[] = []

  const value: Bridge = {
    packaged: false,
    call: () => Promise.reject(new Error("no calls in this test")),
    subscribe: () => {
      const reply = Promise.withResolvers<Reply>()
      replies.push(reply)

      return reply.promise
    },
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
      list: async () => [],
      enable: async () => {},
      disable: async () => {},
      reload: async () => {},
    },
  }

  return {
    value,
    emit: (message: BridgeMessage) => listeners.forEach((listener) => listener(message)),
    /** Answers the latest subscribe. */
    reply: (reply: Reply) => replies.at(-1)?.resolve(reply),
    fail: (cause: unknown) => replies.at(-1)?.reject(cause),
    subscribes: () => replies.length,
  }
}
