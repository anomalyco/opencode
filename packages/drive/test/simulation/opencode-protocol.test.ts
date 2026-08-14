import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { RpcClient, RpcClientError, RpcMessage } from "effect/unstable/rpc"
import * as OpenCodeRpcProtocol from "../../src/simulation/opencode-protocol.js"
import { SimulationRequestError, UiRpcs } from "@opencode-ai/protocol/simulation"
import { sendError, sendResult, startTransportPeer } from "./transport-peer.js"

const state = {
  focused: { renderable: 1, editor: true },
  elements: [],
}

describe("OpenCode Effect RPC compatibility protocol", () => {
  it.live("drives generated UI clients over exact OpenCode JSON-RPC", () => {
    const notifications: unknown[] = []
    const peer = startTransportPeer(({ request, socket }) => {
      if (request.method === "ui.matches") {
        sendError(socket, request, "match failed")
        return
      }
      if (request.method === "ui.state")
        socket.send(
          JSON.stringify({
            jsonrpc: "2.0",
            method: "server.status",
            params: { ready: true },
          }),
        )
      sendResult(socket, request, state)
    })

    return Effect.gen(function* () {
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))
      const protocol = yield* OpenCodeRpcProtocol.make(peer.url, {
        onNotification: (notification) => Effect.sync(() => notifications.push(notification)),
      })
      const client = yield* RpcClient.make(UiRpcs).pipe(Effect.provideService(RpcClient.Protocol, protocol))

      expect(yield* client["ui.state"]()).toEqual(state)
      expect(yield* client["ui.press"]({ key: "right" })).toEqual(state)
      expect(yield* client["ui.press"]({ key: "down", modifiers: { meta: true } })).toEqual(state)
      expect(yield* client["ui.press"]({ key: "tab", modifiers: { ctrl: true } })).toEqual(state)

      const error = yield* client["ui.matches"]({ text: "fail" }).pipe(Effect.flip)
      expect(error).toBeInstanceOf(SimulationRequestError)
      expect(error).toMatchObject({
        method: "ui.matches",
        code: -32000,
        message: "match failed",
      })

      const firstId = peer.received[0]!.request.id
      expect(typeof firstId).toBe("number")
      expect(notifications).toEqual([{ method: "server.status", params: { ready: true } }])
      expect(peer.received.map(({ request }) => request)).toEqual([
        { jsonrpc: "2.0", id: firstId, method: "ui.state" },
        {
          jsonrpc: "2.0",
          id: firstId + 1,
          method: "ui.press",
          params: { key: "\u001b[C" },
        },
        {
          jsonrpc: "2.0",
          id: firstId + 2,
          method: "ui.press",
          params: { key: "\u001b[1;3B" },
        },
        {
          jsonrpc: "2.0",
          id: firstId + 3,
          method: "ui.press",
          params: { key: "\u001b[9;5u" },
        },
        {
          jsonrpc: "2.0",
          id: firstId + 4,
          method: "ui.matches",
          params: { text: "fail" },
        },
      ])
    })
  })

  it.live("correlates multiple generated clients through local wire IDs", () => {
    const secondState = {
      focused: { renderable: 2, editor: false },
      elements: [],
    }
    const received: Array<
      Parameters<typeof sendResult>[1] & {
        readonly socket: Bun.ServerWebSocket<undefined>
      }
    > = []
    const peer = startTransportPeer(({ request, socket }) => {
      received.push({ ...request, socket })
      if (received.length !== 2) return
      sendResult(received[1]!.socket, received[1]!, secondState)
      sendResult(received[0]!.socket, received[0]!, state)
    })

    return Effect.gen(function* () {
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))
      const protocol = yield* OpenCodeRpcProtocol.make(peer.url)
      const options = {
        generateRequestId: () => RpcMessage.RequestId(7),
      }
      const first = yield* RpcClient.make(UiRpcs, options).pipe(Effect.provideService(RpcClient.Protocol, protocol))
      const second = yield* RpcClient.make(UiRpcs, options).pipe(Effect.provideService(RpcClient.Protocol, protocol))
      const results = yield* Effect.all([first["ui.state"](), second["ui.state"]()], { concurrency: "unbounded" })

      expect(results).toEqual([state, secondState])
      expect(peer.received.map(({ request }) => request)).toEqual([
        { jsonrpc: "2.0", id: 1, method: "ui.state" },
        { jsonrpc: "2.0", id: 2, method: "ui.state" },
      ])
    })
  })

  it.live("persists fatal protocol failures for later requests", () => {
    const peer = startTransportPeer(({ request, socket }) =>
      socket.send(JSON.stringify({ jsonrpc: "2.0", id: request.id })),
    )

    return Effect.gen(function* () {
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))
      const protocol = yield* OpenCodeRpcProtocol.make(peer.url)
      const client = yield* RpcClient.make(UiRpcs).pipe(Effect.provideService(RpcClient.Protocol, protocol))

      const first = yield* client["ui.state"]().pipe(Effect.flip)
      expect(first).toBeInstanceOf(RpcClientError.RpcClientError)
      expect(first.message).toContain("JSON-RPC response must contain result or error")

      const second = yield* client["ui.state"]().pipe(Effect.flip)
      expect(second).toBe(first)
      expect(peer.received).toHaveLength(1)
    })
  })
})
