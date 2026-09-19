import { describe, expect } from "bun:test"
import { Duration, Effect } from "effect"
import { TestClock } from "effect/testing"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Bus } from "@opencode/core/bus"
import { Client } from "@opencode/core/client"
import { SessionSchema } from "@opencode/core/session/schema"
import { testEffect } from "./lib/effect"

const clients = AppNodeBuilder.build(LayerNode.group([Bus.node, Client.node]))
const it = testEffect(clients)
const sessionA = SessionSchema.ID.make("ses_a")
const sessionB = SessionSchema.ID.make("ses_b")

describe("Client presence", () => {
  it.effect("registers, lists, updates, and removes a client", () =>
    Effect.gen(function* () {
      const service = yield* Client.Service
      const created = yield* service.register({ kind: "tui", sessions: [sessionA], focused: true })
      expect(created.kind).toBe("tui")
      expect(created.sessions).toEqual([sessionA])
      expect(created.focused).toBe(true)
      expect(yield* service.list()).toEqual([created])
      expect(yield* service.get(created.id)).toEqual(created)

      const updated = yield* service.update(created.id, { sessions: [sessionB], focused: false })
      expect(updated.sessions).toEqual([sessionB])
      expect(updated.focused).toBe(false)
      expect(updated.focusedAt).toBe(created.focusedAt)

      yield* service.remove(created.id)
      expect(yield* service.list()).toEqual([])
      expect(yield* Effect.flip(service.get(created.id))).toBeInstanceOf(Client.NotFoundError)
    }),
  )

  it.effect("rejects a reused client id", () =>
    Effect.gen(function* () {
      const service = yield* Client.Service
      const id = Client.ID.create("client_dup")
      yield* service.register({ id, kind: "tui" })
      expect(yield* Effect.flip(service.register({ id, kind: "desktop" }))).toBeInstanceOf(Client.AlreadyExistsError)
    }),
  )

  it.effect("does not treat a focused heartbeat as a new focus", () =>
    Effect.gen(function* () {
      const service = yield* Client.Service
      const first = yield* service.register({ kind: "tui", sessions: [sessionA], focused: true })
      yield* TestClock.adjust(Duration.millis(5))
      const second = yield* service.register({ kind: "tui", sessions: [sessionA], focused: false })
      yield* TestClock.adjust(Duration.millis(5))
      const gained = yield* service.update(second.id, { focused: true })
      yield* TestClock.adjust(Duration.millis(5))
      const heartbeated = yield* service.update(first.id, { focused: true })
      expect(heartbeated.focusedAt).toBe(first.focusedAt)
      expect(gained.focusedAt).toBeGreaterThan(first.focusedAt)
      const result = yield* service.activate(sessionA)
      expect(result.client?.id).toBe(second.id)
    }),
  )

  it.effect("activates the last-focused client showing the session", () =>
    Effect.gen(function* () {
      const service = yield* Client.Service
      const bus = yield* Bus.Service
      const events: Array<string> = []
      const unsubscribe = yield* bus.listen((event) =>
        event.type === Client.Event.Activate.type
          ? Effect.sync(() => {
              events.push((event.data as { readonly clientID: string }).clientID)
            })
          : Effect.void,
      )
      yield* Effect.addFinalizer(() => unsubscribe)

      const older = yield* service.register({ kind: "tui", sessions: [sessionA], focused: true })
      yield* TestClock.adjust(Duration.millis(5))
      const newer = yield* service.register({ kind: "desktop", sessions: [sessionA], focused: true })
      const result = yield* service.activate(sessionA)
      expect(result.outcome).toBe("activated")
      expect(result.client?.id).toBe(newer.id)
      expect(events).toEqual([newer.id])
      expect(older.id).not.toBe(newer.id)
    }),
  )

  it.effect("falls back to any live tui or desktop when no client shows the session", () =>
    Effect.gen(function* () {
      const service = yield* Client.Service
      const tui = yield* service.register({ kind: "tui", sessions: [sessionA], focused: true })
      const result = yield* service.activate(sessionB)
      expect(result).toEqual({ outcome: "activated", client: tui })
    }),
  )

  it.effect("does not route to a stale client", () =>
    Effect.gen(function* () {
      const service = yield* Client.Service
      yield* service.register({ kind: "tui", sessions: [sessionA], focused: true })
      yield* TestClock.adjust(Duration.millis(Client.STALE_MS + 1))
      expect(yield* service.activate(sessionA)).toEqual({ outcome: "none" })
      expect(yield* service.list()).toEqual([])
    }),
  )

  it.effect("does not steal a web client that is not showing the session", () =>
    Effect.gen(function* () {
      const service = yield* Client.Service
      yield* service.register({ kind: "web", sessions: [sessionA], focused: true })
      expect(yield* service.activate(sessionB)).toEqual({ outcome: "none" })
    }),
  )
})
