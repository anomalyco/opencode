export * as Client from "./client.js"

import { Clock, Context, Effect, Layer, Schema } from "effect"
import { Client } from "@opencode/schema/client"
import { SessionID } from "@opencode/schema/session-id"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Bus } from "./bus.js"

export const ID = Client.ID
export type ID = Client.ID

export const Info = Client.Info
export type Info = Client.Info

export const Kind = Client.Kind
export type Kind = Client.Kind

export const CreateInput = Client.CreateInput
export type CreateInput = Client.CreateInput

export const UpdateInput = Client.UpdateInput
export type UpdateInput = Client.UpdateInput

export const Activate = Client.Activate
export type Activate = Client.Activate

export { Event } from "@opencode/schema/client"

// Presence is process-local. Clients that miss this heartbeat window are dropped.
export const STALE_MS = 45_000

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("Client.NotFoundError", {
  id: ID,
}) {
  override get message() {
    return `Client not found: ${this.id}`
  }
}

export class AlreadyExistsError extends Schema.TaggedError<AlreadyExistsError>()("Client.AlreadyExistsError", {
  id: ID,
}) {
  override get message() {
    return `Client already exists: ${this.id}`
  }
}

export type RegisterInput = CreateInput & { readonly id?: ID }

export interface Interface {
  readonly register: (input: RegisterInput) => Effect.Effect<Info, AlreadyExistsError>
  readonly list: () => Effect.Effect<ReadonlyArray<Info>>
  readonly get: (id: ID) => Effect.Effect<Info, NotFoundError>
  readonly update: (id: ID, input: UpdateInput) => Effect.Effect<Info, NotFoundError>
  readonly remove: (id: ID) => Effect.Effect<void, NotFoundError>
  readonly activate: (sessionID: SessionID) => Effect.Effect<Activate>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Client") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const clients = new Map<ID, Info>()

    const prune = (now: number) => {
      for (const [id, info] of clients) {
        if (now - info.updatedAt <= STALE_MS) continue
        clients.delete(id)
      }
    }

    const require = (id: ID, now: number) => {
      prune(now)
      const info = clients.get(id)
      if (!info) return new NotFoundError({ id })
      return info
    }

    const register = Effect.fn("Client.register")(function* (input: RegisterInput) {
      const now = yield* Clock.currentTimeMillis
      prune(now)
      const id = input.id ?? ID.create()
      if (clients.has(id)) return yield* new AlreadyExistsError({ id })
      const focused = input.focused === true
      const info: Info = {
        id,
        kind: input.kind,
        sessions: input.sessions ?? [],
        focused,
        focusedAt: focused ? now : 0,
        updatedAt: now,
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.pid === undefined ? {} : { pid: input.pid }),
      }
      clients.set(id, info)
      return info
    })

    const list = Effect.fn("Client.list")(function* () {
      prune(yield* Clock.currentTimeMillis)
      return Array.from(clients.values())
    })

    const get = Effect.fn("Client.get")(function* (id: ID) {
      const info = require(id, yield* Clock.currentTimeMillis)
      if (info instanceof NotFoundError) return yield* info
      return info
    })

    const update = Effect.fn("Client.update")(function* (id: ID, input: UpdateInput) {
      const now = yield* Clock.currentTimeMillis
      const current = require(id, now)
      if (current instanceof NotFoundError) return yield* current
      const focused = input.focused ?? current.focused
      const name = input.name !== undefined ? input.name : current.name
      const pid = input.pid !== undefined ? input.pid : current.pid
      const info: Info = {
        id,
        kind: current.kind,
        sessions: input.sessions ?? current.sessions,
        focused,
        focusedAt: input.focused === true && !current.focused ? now : current.focusedAt,
        updatedAt: now,
        ...(name === undefined ? {} : { name }),
        ...(pid === undefined ? {} : { pid }),
      }
      clients.set(id, info)
      return info
    })

    const remove = Effect.fn("Client.remove")(function* (id: ID) {
      const info = require(id, yield* Clock.currentTimeMillis)
      if (info instanceof NotFoundError) return yield* info
      clients.delete(id)
    })

    const activate = Effect.fn("Client.activate")(function* (sessionID: SessionID) {
      const now = yield* Clock.currentTimeMillis
      prune(now)
      const picked = pick(Array.from(clients.values()), sessionID)
      if (!picked) return { outcome: "none" as const }
      yield* bus.publish(Client.Event.Activate, { clientID: picked.id, sessionID })
      return { outcome: "activated" as const, client: picked }
    })

    return Service.of({ register, list, get, update, remove, activate })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [Bus.node] })

function pick(live: ReadonlyArray<Info>, sessionID: SessionID) {
  const candidates = live.filter((info) => canTake(info, sessionID))
  if (candidates.length === 0) return
  return candidates.reduce((best, info) => (compare(info, best, sessionID) > 0 ? info : best))
}

function canTake(info: Info, sessionID: SessionID) {
  if (info.kind === "tui" || info.kind === "desktop") return true
  return info.sessions.includes(sessionID)
}

function compare(left: Info, right: Info, sessionID: SessionID) {
  const showing = Number(left.sessions.includes(sessionID)) - Number(right.sessions.includes(sessionID))
  if (showing !== 0) return showing
  const focused = Number(left.focused) - Number(right.focused)
  if (focused !== 0) return focused
  if (left.focusedAt !== right.focusedAt) return left.focusedAt - right.focusedAt
  return left.updatedAt - right.updatedAt
}
