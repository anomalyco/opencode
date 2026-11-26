export * as BrowserTunnelGateway from "./browser-tunnel.js"

import { randomBytes } from "node:crypto"
import { StreamWire } from "@opencode/plugin-browser/experimental/stream"
import { BrowserTunnelHost } from "@opencode/plugin-browser/experimental/tunnel-host"

export type BinarySocket = BrowserTunnelHost.BinarySocket
export const MAX_WS_FRAME_BYTES = StreamWire.MAX_WS_FRAME_BYTES
import type { Location } from "@opencode/schema/location"
import type { Session } from "@opencode/schema/session"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Clock, Context, Duration, Effect, Layer } from "effect"

const DEFAULT_TTL = Duration.seconds(30)
const MAX_PENDING_TICKETS = 2_048

type TicketEntry = {
  readonly binding: BrowserTunnelHost.TicketBinding
  readonly attachmentKey: string
  readonly expiresAt: number
}

export interface ConsumeInput {
  readonly ticket: string
  readonly location: Location.Ref
  readonly sessionID: Session.ID
  readonly connectionID: string
  readonly protocol: number
}

export interface Interface {
  readonly issueTicket: (
    binding: BrowserTunnelHost.TicketBinding,
  ) => Effect.Effect<BrowserTunnelHost.IssuedTicket, Error>
  readonly consumeTicket: (input: ConsumeInput) => Effect.Effect<BrowserTunnelHost.TicketBinding | undefined>
  readonly revokeAttachment: (sessionID: Session.ID, connectionID: string, generation: number) => Effect.Effect<void>
  readonly addReservedLocalPort: (port: number) => Effect.Effect<void>
  readonly removeReservedLocalPort: (port: number) => Effect.Effect<void>
  readonly reservedLocalPorts: () => ReadonlySet<number>
  readonly hostForLocation: (enabled: Effect.Effect<boolean>) => BrowserTunnelHost.Interface
}

export class Service extends Context.Service<Service, Interface>()("@opencode/BrowserTunnelGateway") {}

function attachmentKey(sessionID: Session.ID, connectionID: string, generation: number) {
  return `${sessionID}\0${connectionID}\0${generation}`
}

function sameLocation(a: Location.Ref, b: Location.Ref) {
  return a.directory === b.directory && a.workspaceID === b.workspaceID
}

export const make = (ttl: Duration.Input = DEFAULT_TTL) =>
  Effect.gen(function* () {
    const ttlMs = Math.max(1_000, Duration.toMillis(Duration.fromInputUnsafe(ttl)))
    const expiresIn = Math.max(1, Math.round(ttlMs / 1_000))
    const tickets = new Map<string, TicketEntry>()
    const byAttachment = new Map<string, Set<string>>()
    const reservedPorts = new Set<number>()

    const removeTicket = (ticket: string) => {
      const entry = tickets.get(ticket)
      if (!entry) return undefined
      tickets.delete(ticket)
      const set = byAttachment.get(entry.attachmentKey)
      if (set) {
        set.delete(ticket)
        if (set.size === 0) byAttachment.delete(entry.attachmentKey)
      }
      return entry
    }

    const sweep = (now: number) => {
      for (const [ticket, entry] of tickets) {
        if (entry.expiresAt <= now) removeTicket(ticket)
      }
    }

    const issueTicket = Effect.fn("BrowserTunnelGateway.issueTicket")(function* (
      binding: BrowserTunnelHost.TicketBinding,
    ) {
      const now = yield* Clock.currentTimeMillis
      sweep(now)
      if (tickets.size >= MAX_PENDING_TICKETS) {
        return yield* Effect.fail(new Error("Too many pending browser tunnel upgrade tickets."))
      }
      const ticket = randomBytes(32).toString("base64url")
      const key = attachmentKey(binding.sessionID, binding.connectionID, binding.generation)
      tickets.set(ticket, { binding, attachmentKey: key, expiresAt: now + ttlMs })
      const set = byAttachment.get(key) ?? new Set<string>()
      set.add(ticket)
      byAttachment.set(key, set)
      return {
        ticket,
        expiresIn,
        protocol: binding.protocol,
        path: BrowserTunnelHost.BROWSER_TUNNEL_PATH,
      }
    })

    const consumeTicket = Effect.fn("BrowserTunnelGateway.consumeTicket")(function* (input: ConsumeInput) {
      const now = yield* Clock.currentTimeMillis
      const entry = tickets.get(input.ticket)
      if (!entry) return undefined
      if (entry.expiresAt <= now) {
        removeTicket(input.ticket)
        return undefined
      }
      const binding = entry.binding
      if (
        binding.sessionID !== input.sessionID ||
        binding.connectionID !== input.connectionID ||
        binding.protocol !== input.protocol ||
        !sameLocation(binding.location, input.location)
      ) {
        return undefined
      }
      // Atomic single-use removal: a ticket can never be replayed.
      removeTicket(input.ticket)
      return binding
    })

    const revokeAttachment = Effect.fn("BrowserTunnelGateway.revokeAttachment")(function* (
      sessionID: Session.ID,
      connectionID: string,
      generation: number,
    ) {
      const key = attachmentKey(sessionID, connectionID, generation)
      const set = byAttachment.get(key)
      if (!set) return
      for (const ticket of Array.from(set)) removeTicket(ticket)
    })

    const gateway: Interface = {
      issueTicket,
      consumeTicket,
      revokeAttachment,
      addReservedLocalPort: (port) =>
        Effect.sync(() => {
          if (Number.isInteger(port) && port >= 1 && port <= 65_535) reservedPorts.add(port)
        }),
      removeReservedLocalPort: (port) =>
        Effect.sync(() => {
          reservedPorts.delete(port)
        }),
      reservedLocalPorts: () => reservedPorts,
      hostForLocation: (enabled) => ({
        enabled,
        reservedLocalPorts: () => reservedPorts,
        issueTicket: (binding) => issueTicket(binding).pipe(Effect.orDie),
        revokeAttachment,
      }),
    }

    return Service.of(gateway)
  })

const layer = Layer.effect(Service, make())

export const node = makeGlobalNode({ service: Service, layer, deps: [] })
