import { describe, expect, test } from "bun:test"
import { EventEmitter } from "node:events"
import { MessageChannel } from "node:worker_threads"
import type { MessagePortMain, WebContents } from "electron"
import { Effect, Layer, ManagedRuntime, Predicate, Schema, Stream } from "effect"
import { Rpc, RpcGroup, RpcMessage, RpcServer } from "effect/unstable/rpc"
import { Transferable } from "effect/unstable/workers"
import { omitUndefined } from "../shared/ipc-transport"
import { FilesOpenFilePicker } from "../shared/ipc-rpc/files"
import { IpcPortHandoff, IpcServerProtocolLive } from "./ipc-transport"

describe("desktop RPC transport", () => {
  test("decodes renderer payloads whose optional fields are undefined", async () => {
    let received: unknown
    const rpcs = RpcGroup.make(FilesOpenFilePicker)

    const handlers = rpcs.toLayer({
      FilesOpenFilePicker: ({ options }) =>
        Effect.sync(() => {
          received = options

          return null
        }),
    })

    const live = RpcServer.layer(rpcs).pipe(Layer.provide(handlers), Layer.provideMerge(IpcServerProtocolLive))
    const runtime = ManagedRuntime.make(live)
    const handoff = await runtime.runPromise(IpcPortHandoff)
    const channel = new MessageChannel()
    handoff.bind(sender(1), serverPort(channel.port1))
    // What openAttachmentPickerDialog sends for the composer's attach button.
    const payload = { options: { multiple: true, title: undefined, defaultPath: "C:\\project", extensions: undefined } }

    // Structured clone keeps a present-but-undefined key, so it reaches the JSON codec.
    const rejected = await call(channel.port2, 0, "FilesOpenFilePicker", payload)
    expect(rejected.exit).toMatchObject(died(expect.stringContaining('["options"]["title"]')))

    const accepted = await call(channel.port2, 1, "FilesOpenFilePicker", omitUndefined(payload))
    expect(accepted.exit).toEqual(success(null))
    expect(received).toEqual({ multiple: true, defaultPath: "C:\\project" })

    channel.port2.close()
    await runtime.dispose()
  })

  test("omitting undefined fields leaves bytes and defined values alone", () => {
    const data = new Uint8Array([0, 255, 2])
    expect(omitUndefined(data)).toBe(data)
    // Strict equality: a kept `drop: undefined` key must fail the match.
    expect(omitUndefined({ data, nested: [{ keep: null, drop: undefined }], count: 0 })).toStrictEqual({
      data,
      nested: [{ keep: null }],
      count: 0,
    })
  })

  test("keeps multiple renderer ports independent", async () => {
    let received: unknown

    const handlers = TestRpcs.toLayer(
      Effect.gen(function* () {
        const handoff = yield* IpcPortHandoff

        return TestRpcs.of({
          "test.focused": (_request, context) => Effect.succeed(handoff.sender(context.client.id)?.id === 1),
          "test.blob.put": ({ data }) => {
            received = data

            return Effect.succeed([...data].join(","))
          },
          "test.blob.get": () => Effect.succeed(new Uint8Array([3, 1, 4])),
          "test.events": () => Stream.make(new TestEvent({ value: "session.new" })),
        })
      }),
    )

    const live = RpcServer.layer(TestRpcs).pipe(Layer.provide(handlers), Layer.provideMerge(IpcServerProtocolLive))
    const runtime = ManagedRuntime.make(live)
    const handoff = await runtime.runPromise(IpcPortHandoff)
    const first = new MessageChannel()
    const second = new MessageChannel()
    handoff.bind(sender(1), serverPort(first.port1))
    handoff.bind(sender(2), serverPort(second.port1))

    const [focused, unfocused] = await Promise.all([
      call(first.port2, 0, "test.focused", null),
      call(second.port2, 0, "test.focused", null),
    ])

    expect(focused.exit).toEqual(success(true))
    expect(unfocused.exit).toEqual(success(false))
    const put = await call(first.port2, 1, "test.blob.put", omitUndefined({ data: new Uint8Array([2, 7, 1]) }))
    expect(put.exit).toEqual(success("2,7,1"))
    // Binary payloads arrive as bytes, not as base64 text or a plain object.
    expect(received).toBeInstanceOf(Uint8Array)
    expect((await call(first.port2, 2, "test.blob.get", null)).exit).toEqual(success(new Uint8Array([3, 1, 4])))
    expect((await call(first.port2, 3, "test.events", null)).chunks).toEqual([
      Schema.encodeSync(TestEvent)(new TestEvent({ value: "session.new" })),
    ])

    const reloaded = new MessageChannel()
    handoff.bind(sender(1), serverPort(reloaded.port1))

    const [reloadedFocused, stillUnfocused] = await Promise.all([
      call(reloaded.port2, 0, "test.focused", null),
      call(second.port2, 1, "test.focused", null),
    ])

    expect(reloadedFocused.exit).toEqual(success(true))
    expect(stillUnfocused.exit).toEqual(success(false))

    for (const port of [first.port2, second.port2, reloaded.port2]) port.close()
    await runtime.dispose()
  })
})

class TestEvent extends Schema.TaggedClass<TestEvent>()("TestEvent", { value: Schema.String }) {}

const TestRpcs = RpcGroup.make(
  Rpc.make("test.focused", { success: Schema.Boolean }),
  Rpc.make("test.blob.put", { payload: { data: Transferable.Uint8Array }, success: Schema.String }),
  Rpc.make("test.blob.get", { success: Transferable.Uint8Array }),
  Rpc.make("test.events", { success: TestEvent, stream: true }),
)

// SAFETY: these are the RPC wire format's plain encoded messages and exits, which the tests post and expect as is.
/* oxlint-disable anti-slop-effect/no-manual-tagged-construction -- see SAFETY above */
function success<A>(value: A) {
  return { _tag: "Success", value } as const
}

function died<A>(defect: A) {
  return { _tag: "Failure", cause: [{ _tag: "Die", defect }] } as const
}

// Speaks the wire format the way src/renderer/ipc-client.ts does: post a request, ack each chunk,
// and settle on the exit. The payload is posted as given so a test can send what omitUndefined drops.
function call(port: MessageChannel["port2"], id: number, tag: string, payload: RpcMessage.RequestEncoded["payload"]) {
  const chunks: unknown[] = []

  return new Promise<{ chunks: unknown[]; exit: RpcMessage.ResponseExitEncoded["exit"] }>((resolve) => {
    const onMessage = (message: RpcMessage.FromServerEncoded) => {
      if (!("requestId" in message) || Number(message.requestId) !== id) return

      if (Predicate.isTagged(message, "Chunk")) {
        chunks.push(...message.values)
        port.postMessage({ _tag: "Ack", requestId: message.requestId } satisfies RpcMessage.AckEncoded)

        return
      }

      port.off("message", onMessage)
      resolve({ chunks, exit: message.exit })
    }

    port.on("message", onMessage)
    port.postMessage({ _tag: "Request", id, tag, payload, headers: [] })
  })
}
/* oxlint-enable anti-slop-effect/no-manual-tagged-construction */

function sender(id: number) {
  const events = new EventEmitter()

  // SAFETY: the transport reads only a sender's `id` and `isDestroyed`, and its `destroyed` event.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
  return {
    id,
    isDestroyed: () => false,
    once: events.once.bind(events),
    off: events.off.bind(events),
  } as unknown as WebContents
}

function serverPort(port: MessageChannel["port1"]) {
  const listeners = new Map<(event: Electron.MessageEvent) => void, (data: Electron.MessageEvent["data"]) => void>()

  const fake = {
    on(event: string, listener: (event: Electron.MessageEvent) => void) {
      if (event !== "message") {
        port.on(event, listener)

        return
      }

      // SAFETY: the transport reads only the `data` of a message event.
      const wrapped = (data: Electron.MessageEvent["data"]) => listener({ data } as Electron.MessageEvent)
      listeners.set(listener, wrapped)
      port.on("message", wrapped)
    },
    off(event: string, listener: (event: Electron.MessageEvent) => void) {
      if (event !== "message") {
        port.off(event, listener)

        return
      }

      const wrapped = listeners.get(listener)

      if (wrapped) port.off("message", wrapped)
    },
    postMessage: port.postMessage.bind(port),
    start: port.start.bind(port),
    close: port.close.bind(port),
  }

  // SAFETY: the transport uses only these methods of a port.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
  return fake as unknown as MessagePortMain
}
