import { beforeEach, describe, expect, mock, test } from "bun:test"

type WSHandlerFactory = (ctx: { req: { param: (key: string) => string } }) => {
  onOpen?: (event: unknown, ws: { send: (value: string) => void }) => void
  onClose?: () => void
}

const wsFactories: WSHandlerFactory[] = []
let busSubscriber: ((event: { properties: { id: string; kind: "exit" | "disconnect" | "error"; exitCode?: number; message?: string } }) => void) | undefined
let unsubCount = 0

mock.module("hono-openapi", () => ({
  describeRoute: () => (_c: unknown, next: () => Promise<void>) => next(),
  validator: () => (_c: unknown, next: () => Promise<void>) => next(),
  resolver: (value: unknown) => value,
}))

mock.module("hono/bun", () => ({
  upgradeWebSocket: (factory: WSHandlerFactory) => {
    wsFactories.push(factory)
    return () => new Response("ok")
  },
}))

mock.module("@/pty", () => ({
  Pty: {
    get: (id: string) => (id === "missing" ? undefined : { id }),
    list: () => [],
    create: async () => ({}),
    update: async () => ({}),
    remove: async () => {},
    connect: () => ({ onMessage() {}, onClose() {} }),
    Info: {
      array: () => ({}),
    },
    CreateInput: {},
    UpdateInput: {},
    Event: {
      Stream: { type: "pty.stream" },
    },
  },
}))

mock.module("@/bus", () => ({
  Bus: {
    subscribe: (_def: unknown, cb: typeof busSubscriber) => {
      busSubscriber = cb
      return () => {
        unsubCount += 1
      }
    },
  },
}))

mock.module("../../storage/storage", () => ({
  Storage: {
    NotFoundError: class NotFoundError extends Error {},
  },
}))

const { PtyRoutes } = await import("./pty")

beforeEach(() => {
  wsFactories.length = 0
  busSubscriber = undefined
  unsubCount = 0
  PtyRoutes.reset()
})

describe("pty lifecycle websocket route", () => {
  test("maps stream lifecycle events to typed websocket payloads and unsubscribes on close", () => {
    PtyRoutes()
    expect(wsFactories.length).toBeGreaterThanOrEqual(2)
    const lifecycleFactory = wsFactories[1]
    expect(lifecycleFactory).toBeDefined()

    const ws = {
      sent: [] as string[],
      send(value: string) {
        this.sent.push(value)
      },
    }
    const handlers = lifecycleFactory!({
      req: {
        param: () => "pty-1",
      },
    })
    handlers.onOpen?.({}, ws)
    expect(busSubscriber).toBeDefined()

    busSubscriber?.({
      properties: {
        id: "pty-2",
        kind: "disconnect",
      },
    })
    busSubscriber?.({
      properties: {
        id: "pty-1",
        kind: "disconnect",
      },
    })
    busSubscriber?.({
      properties: {
        id: "pty-1",
        kind: "error",
        message: "replay_send_failed",
      },
    })
    busSubscriber?.({
      properties: {
        id: "pty-1",
        kind: "exit",
        exitCode: 9,
      },
    })

    expect(ws.sent).toEqual([
      JSON.stringify({ type: "pty.lifecycle", event: "disconnect", ptyID: "pty-1" }),
      JSON.stringify({
        type: "pty.lifecycle",
        event: "error",
        ptyID: "pty-1",
        message: "replay_send_failed",
      }),
      JSON.stringify({
        type: "pty.lifecycle",
        event: "exit",
        ptyID: "pty-1",
        exitCode: 9,
      }),
    ])

    handlers.onClose?.()
    expect(unsubCount).toBe(1)
  })

  test("throws for missing pty session on lifecycle route", () => {
    PtyRoutes()
    const lifecycleFactory = wsFactories[1]
    expect(() =>
      lifecycleFactory!({
        req: {
          param: () => "missing",
        },
      }),
    ).toThrow("Session not found")
  })
})
