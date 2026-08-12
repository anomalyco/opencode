import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import * as OpenCodeUi from "../../src/driver/ui.js"
import * as SimulationConnector from "../../src/simulation/connector.js"
import { sendError, sendResult, startTransportPeer } from "../simulation/transport-peer.js"

const editor = {
  id: "prompt",
  num: 3,
  x: 2,
  y: 4,
  width: 20,
  height: 6,
  focusable: true,
  focused: true,
  clickable: true,
  editor: true,
}

const state = {
  focused: { renderable: 3, editor: true },
  elements: [editor],
}

const snapshot = {
  format: "opencode-ui-snapshot-v1",
  nodes: [
    {
      id: "session.permission",
      instance: "permission-1",
      role: "dialog",
      label: "Permission required: Edit fixture.txt",
      element: 2,
      expanded: false,
    },
    {
      id: "session.permission.action.once",
      instance: "permission-1",
      parent: "session.permission",
      role: "option",
      label: "Allow once",
      element: 3,
      focused: true,
      selected: true,
      disabled: false,
    },
  ],
}

const frame = {
  cols: 2,
  rows: 1,
  cursor: [0, 0] as const,
  lines: [{ spans: [{ text: "ok", fg: [255, 255, 255, 255] as const, bg: [0, 0, 0, 255] as const, attributes: 0, width: 2 }] }],
}

describe("OpenCodeUi", () => {
  it.live("captures a normalized terminal frame", () => {
    const peer = startTransportPeer(({ request, socket }) => sendResult(socket, request, frame))

    return Effect.gen(function* () {
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))
      const connection = yield* SimulationConnector.ui(peer.url)
      expect(yield* OpenCodeUi.make(connection).capture()).toEqual(frame)
      expect(peer.received.map(({ request }) => request)).toEqual([
        { jsonrpc: "2.0", id: 1, method: "ui.capture" },
      ])
    })
  })

  it.live("wraps generated UI RPCs with user-level operations", () => {
    let matchCalls = 0
    const peer = startTransportPeer(({ request, socket }) => {
      if (request.method === "ui.matches") {
        matchCalls++
        sendResult(socket, request, matchCalls > 1)
        return
      }
      if (request.method === "ui.screenshot") {
        sendResult(socket, request, "/tmp/home.png")
        return
      }
      sendResult(socket, request, state)
    })

    return Effect.gen(function* () {
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))
      const connection = yield* SimulationConnector.ui(peer.url)
      const ui = OpenCodeUi.make(connection)

      expect(yield* ui.submit("hello")).toEqual(state)
      expect(yield* ui.press("escape", { ctrl: true })).toEqual(state)
      expect(yield* ui.click(3)).toEqual(state)
      expect(yield* ui.screenshot("home")).toBe("/tmp/home.png")
      expect(yield* ui.waitFor("ready", { timeout: 1_000, interval: 1 })).toEqual(state)
      expect(yield* ui.getElement({ editor: true })).toEqual(editor)

      expect(peer.received.map(({ request }) => request)).toEqual([
        {
          jsonrpc: "2.0",
          id: 1,
          method: "ui.type",
          params: { text: "hello" },
        },
        { jsonrpc: "2.0", id: 2, method: "ui.enter" },
        {
          jsonrpc: "2.0",
          id: 3,
          method: "ui.press",
          params: { key: "escape", modifiers: { ctrl: true } },
        },
        { jsonrpc: "2.0", id: 4, method: "ui.state" },
        {
          jsonrpc: "2.0",
          id: 5,
          method: "ui.click",
          params: { target: 3, x: 10, y: 3 },
        },
        {
          jsonrpc: "2.0",
          id: 6,
          method: "ui.screenshot",
          params: { name: "home" },
        },
        {
          jsonrpc: "2.0",
          id: 7,
          method: "ui.matches",
          params: { text: "ready" },
        },
        {
          jsonrpc: "2.0",
          id: 8,
          method: "ui.matches",
          params: { text: "ready" },
        },
        { jsonrpc: "2.0", id: 9, method: "ui.state" },
        { jsonrpc: "2.0", id: 10, method: "ui.state" },
      ])
    })
  })

  it.live("selects and clicks semantic UI nodes", () => {
    let snapshotCalls = 0
    const peer = startTransportPeer(({ request, socket }) => {
      if (request.method === "ui.snapshot") {
        snapshotCalls++
        sendResult(
          socket,
          request,
          snapshotCalls === 2
            ? { format: "opencode-ui-snapshot-v1", nodes: [] }
            : snapshot,
        )
        return
      }
      sendResult(socket, request, state)
    })

    return Effect.gen(function* () {
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))
      const connection = yield* SimulationConnector.ui(peer.url)
      const ui = OpenCodeUi.make(connection)

      expect(yield* ui.snapshot()).toEqual(snapshot)
      const option = yield* ui.getNode({
        instance: "permission-1",
        role: "option",
        selected: true,
        disabled: false,
      }, { interval: 1 })
      expect(option).toEqual(snapshot.nodes[1])
      expect(yield* ui.click(option)).toEqual(state)
      expect(peer.received.map(({ request }) => request)).toEqual([
        { jsonrpc: "2.0", id: 1, method: "ui.snapshot" },
        { jsonrpc: "2.0", id: 2, method: "ui.snapshot" },
        { jsonrpc: "2.0", id: 3, method: "ui.snapshot" },
        { jsonrpc: "2.0", id: 4, method: "ui.state" },
        {
          jsonrpc: "2.0",
          id: 5,
          method: "ui.click",
          params: {
            target: 3,
            x: 10,
            y: 3,
            semantic: {
              id: "session.permission.action.once",
              instance: "permission-1",
              element: 3,
            },
          },
        },
      ])
    })
  })

  it.live("sends stale semantic handles to the endpoint without polling", () => {
    const peer = startTransportPeer(({ request, socket }) => {
      if (request.method === "ui.state") {
        sendResult(socket, request, { ...state, elements: [] })
        return
      }
      sendError(socket, request, "target is stale")
    })

    return Effect.gen(function* () {
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))
      const connection = yield* SimulationConnector.ui(peer.url)
      const error = yield* OpenCodeUi.make(connection)
        .click(snapshot.nodes[1]!)
        .pipe(Effect.flip)

      expect(error).toMatchObject({
        _tag: "SimulationRequestError",
        method: "ui.click",
        message: "target is stale",
      })
      expect(peer.received.map(({ request }) => request)).toEqual([
        { jsonrpc: "2.0", id: 1, method: "ui.state" },
        {
          jsonrpc: "2.0",
          id: 2,
          method: "ui.click",
          params: {
            target: 3,
            x: 0,
            y: 0,
            semantic: {
              id: "session.permission.action.once",
              instance: "permission-1",
              element: 3,
            },
          },
        },
      ])
    })
  })

  it.live("reports unavailable semantic snapshots without breaking older endpoints", () => {
    const peer = startTransportPeer(({ request, socket }) => {
      if (request.method === "simulation.handshake") {
        const params = request.params as {
          readonly requiredCapabilities: ReadonlyArray<string>
        }
        sendResult(socket, request, {
          protocolVersion: 1,
          role: "ui",
          server: { name: "opencode", version: "older" },
          capabilities: params.requiredCapabilities,
        })
        return
      }
      sendResult(socket, request, state)
    }, { handshake: false })

    return Effect.gen(function* () {
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))
      const connection = yield* SimulationConnector.ui(peer.url)
      const ui = OpenCodeUi.make(connection)

      expect(yield* ui.state()).toEqual(state)
      const error = yield* ui.snapshot().pipe(Effect.flip)
      expect(error).toBeInstanceOf(OpenCodeUi.UiCapabilityError)
      expect(error).toMatchObject({
        capability: "ui.snapshot",
        message: "ui.snapshot is not available on this OpenCode endpoint",
      })
      const clickError = yield* ui.click(snapshot.nodes[1]!).pipe(Effect.flip)
      expect(clickError).toMatchObject({
        capability: "ui.click.semantic",
        message: "semantic ui.click is not available on this OpenCode endpoint",
      })
      expect(peer.received.map(({ request }) => request.method)).toEqual([
        "simulation.handshake",
        "ui.state",
      ])
    })
  })

  it.live("reports ambiguous semantic nodes as typed UI failures", () => {
    const peer = startTransportPeer(({ request, socket }) =>
      sendResult(socket, request, {
        ...snapshot,
        nodes: [
          snapshot.nodes[0],
          snapshot.nodes[1],
          {
            ...snapshot.nodes[1],
            id: "session.permission.action.always",
            element: 4,
          },
        ],
      }),
    )

    return Effect.gen(function* () {
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))
      const connection = yield* SimulationConnector.ui(peer.url)
      const error = yield* OpenCodeUi.make(connection)
        .getNode({ role: "option" })
        .pipe(Effect.flip)
      expect(error).toBeInstanceOf(OpenCodeUi.UiNodeAmbiguousError)
      expect(error).toMatchObject({
        count: 2,
        message: "ui.getNode matched 2 semantic nodes",
      })
    })
  })

  it.live("reports ambiguous elements as typed UI failures", () => {
    const peer = startTransportPeer(({ request, socket }) =>
      sendResult(socket, request, {
        ...state,
        elements: [editor, { ...editor, num: 4 }],
      }),
    )

    return Effect.gen(function* () {
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))
      const connection = yield* SimulationConnector.ui(peer.url)
      const error = yield* OpenCodeUi.make(connection).getElement({ editor: true }).pipe(Effect.flip)
      expect(error).toBeInstanceOf(OpenCodeUi.UiElementAmbiguousError)
      expect(error).toMatchObject({
        count: 2,
        message: "ui.getElement matched 2 elements",
      })
    })
  })

  it.live("rejects non-boolean Effect predicate values", () => {
    const peer = startTransportPeer(({ request, socket }) =>
      sendResult(socket, request, state),
    )

    return Effect.gen(function* () {
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))
      const connection = yield* SimulationConnector.ui(peer.url)
      const predicate = (() => Effect.succeed("not boolean")) as unknown as
        OpenCodeUi.EffectPredicate<never>
      const error = yield* OpenCodeUi.make(connection)
        .waitFor(predicate)
        .pipe(Effect.flip)

      expect(error).toBeInstanceOf(OpenCodeUi.UiPredicateError)
      expect(error).toMatchObject({
        message: "ui.waitFor predicate must return a boolean or Effect",
      })
    })
  })

  it.live("interrupts timed-out polling and remains usable", () => {
    const peer = startTransportPeer(({ request, socket }) => {
      if (request.method === "ui.matches") return
      if (request.method === "ui.capture") {
        sendResult(socket, request, frame)
        return
      }
      sendResult(socket, request, state)
    })

    return Effect.gen(function* () {
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))
      const connection = yield* SimulationConnector.ui(peer.url)
      const ui = OpenCodeUi.make(connection)
      const error = yield* ui.waitFor("never", { timeout: 20, interval: 100 }).pipe(Effect.flip)

      expect(error).toBeInstanceOf(OpenCodeUi.UiTimeoutError)
      expect(error).toMatchObject({
        operation: "waitFor",
        milliseconds: 20,
        frame,
      })
      expect(yield* ui.state()).toEqual(state)
      expect(peer.received.map(({ request }) => request)).toEqual([
        {
          jsonrpc: "2.0",
          id: 1,
          method: "ui.matches",
          params: { text: "never" },
        },
        { jsonrpc: "2.0", id: 2, method: "ui.capture" },
        { jsonrpc: "2.0", id: 3, method: "ui.state" },
      ])
    })
  })

  it.live("preserves the polling timeout when evidence capture fails", () => {
    const peer = startTransportPeer(({ request, socket }) => {
      if (request.method === "ui.matches") return
      sendError(socket, request, "capture failed")
    })

    return Effect.gen(function* () {
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))
      const connection = yield* SimulationConnector.ui(peer.url)
      const error = yield* OpenCodeUi.make(connection)
        .waitFor("never", { timeout: 20, interval: 100 })
        .pipe(Effect.flip)

      expect(error).toBeInstanceOf(OpenCodeUi.UiTimeoutError)
      expect(error).toMatchObject({
        operation: "waitFor",
        milliseconds: 20,
        message: 'timed out waiting for the UI to match "never"',
      })
      expect(error).not.toHaveProperty("frame")
      expect(peer.received.map(({ request }) => request)).toEqual([
        {
          jsonrpc: "2.0",
          id: 1,
          method: "ui.matches",
          params: { text: "never" },
        },
        { jsonrpc: "2.0", id: 2, method: "ui.capture" },
      ])
    })
  })

  it.live("does not retry RPC failures while polling", () => {
    const peer = startTransportPeer(({ request, socket }) => sendError(socket, request, "match failed"))

    return Effect.gen(function* () {
      yield* Effect.addFinalizer(() => Effect.promise(() => peer.stop()))
      const connection = yield* SimulationConnector.ui(peer.url)
      const error = yield* OpenCodeUi.make(connection)
        .waitFor("ready", { timeout: 1_000, interval: 1 })
        .pipe(Effect.flip)
      expect(error).toMatchObject({
        _tag: "SimulationRequestError",
        method: "ui.matches",
        message: "match failed",
      })
      expect(peer.received).toHaveLength(1)
    })
  })
})
