import { describe, expect, it, test } from "@effect/vitest"
import { Effect } from "effect"
import { Frontend } from "../../src/client/index.js"
import * as SimulationConnector from "../../src/simulation/connector.js"
import { sendResult, startTransportPeer } from "./transport-peer.js"

const state: Frontend.State = {
  focused: { renderable: 1, editor: true },
  elements: [],
}

const snapshot: Frontend.SemanticSnapshot = {
  format: "opencode-ui-snapshot-v1",
  nodes: [{ id: "prompt", role: "textbox", element: 1, focused: true }],
}

describe("OpenCode UI simulation transport", () => {
  it.live("preserves every UI call's exact JSON-RPC frame", () =>
    Effect.gen(function* () {
      const peer = startTransportPeer(({ request, socket }) => {
        if (request.method === "ui.snapshot") {
          sendResult(socket, request, snapshot)
          return
        }
        if (request.method === "ui.matches") {
          sendResult(socket, request, true)
          return
        }
        if (request.method === "ui.recording.finish") {
          sendResult(socket, request, "/tmp/recording.jsonl")
          return
        }
        sendResult(socket, request, state)
      })
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))
      const { rpc } = yield* SimulationConnector.ui(peer.url)

      expect(yield* rpc["ui.state"]()).toEqual(state)
      expect(yield* rpc["ui.snapshot"]()).toEqual(snapshot)
      expect(yield* rpc["ui.matches"]({ text: "needle" })).toBe(true)
      expect(yield* rpc["ui.recording.finish"]()).toBe("/tmp/recording.jsonl")
      expect(yield* rpc["ui.type"]({ text: "hello" })).toEqual(state)
      expect(yield* rpc["ui.press"]({ key: "x" })).toEqual(state)
      expect(yield* rpc["ui.press"]({ key: "x", modifiers: { ctrl: true, shift: false } })).toEqual(state)
      expect(yield* rpc["ui.press"]({ key: "escape" })).toEqual(state)
      expect(yield* rpc["ui.enter"]()).toEqual(state)
      expect(yield* rpc["ui.arrow"]({ direction: "left" })).toEqual(state)
      expect(yield* rpc["ui.focus"]({ target: 7 })).toEqual(state)
      expect(yield* rpc["ui.click"]({ target: 7, x: 3, y: 2 })).toEqual(state)
      expect(yield* rpc["ui.resize"]({ cols: 120, rows: 40 })).toEqual(state)

      expect(peer.received.map(({ request }) => request)).toEqual([
        { jsonrpc: "2.0", id: 1, method: "ui.state" },
        { jsonrpc: "2.0", id: 2, method: "ui.snapshot" },
        {
          jsonrpc: "2.0",
          id: 3,
          method: "ui.matches",
          params: { text: "needle" },
        },
        { jsonrpc: "2.0", id: 4, method: "ui.recording.finish" },
        {
          jsonrpc: "2.0",
          id: 5,
          method: "ui.type",
          params: { text: "hello" },
        },
        {
          jsonrpc: "2.0",
          id: 6,
          method: "ui.press",
          params: { key: "x" },
        },
        {
          jsonrpc: "2.0",
          id: 7,
          method: "ui.press",
          params: { key: "x", modifiers: { ctrl: true, shift: false } },
        },
        {
          jsonrpc: "2.0",
          id: 8,
          method: "ui.press",
          params: { key: "escape" },
        },
        { jsonrpc: "2.0", id: 9, method: "ui.enter" },
        {
          jsonrpc: "2.0",
          id: 10,
          method: "ui.arrow",
          params: { direction: "left" },
        },
        {
          jsonrpc: "2.0",
          id: 11,
          method: "ui.focus",
          params: { target: 7 },
        },
        {
          jsonrpc: "2.0",
          id: 12,
          method: "ui.click",
          params: { target: 7, x: 3, y: 2 },
        },
        {
          jsonrpc: "2.0",
          id: 13,
          method: "ui.resize",
          params: { cols: 120, rows: 40 },
        },
      ])

      for (const { request } of peer.received) expect(Frontend.decodeRequest(request)).toEqual(request)
    }),
  )

  test("rejects schema-invalid UI requests", () => {
    expect(() => Frontend.decodeRequest({ jsonrpc: "2.0", method: "ui.type", params: {} })).toThrow()
    expect(() =>
      Frontend.decodeRequest({
        jsonrpc: "2.0",
        method: "ui.arrow",
        params: { direction: "diagonal" },
      }),
    ).toThrow()
    expect(() =>
      Frontend.decodeRequest({
        jsonrpc: "2.0",
        method: "ui.press",
        params: { key: "x", modifiers: { ctrl: "true" } },
      }),
    ).toThrow()
  })
})
