export * as PtyTicket from "./ticket.js"

import type { Workspace } from "@opencode/schema/workspace"
import { PtyTicket } from "@opencode/schema/pty-ticket"
import type { Pty } from "@opencode/schema/pty"
import { Cache, Context, Duration, Effect, Layer } from "effect"
import { makeGlobalNode } from "@opencode/util/effect/app-node"

const DEFAULT_TTL = Duration.seconds(60)
const CAPACITY = 10_000

export const ConnectToken = PtyTicket.ConnectToken

// A ticket authorizes one upgrade to one target: a PTY, or a client MCP connection by client name.
export type Target =
  | { readonly ptyID: Pty.ID; readonly mcpClient?: never }
  | { readonly mcpClient: string; readonly ptyID?: never }

export type Scope = Target & {
  readonly directory?: string
  readonly workspaceID?: Workspace.ID
}

type Stored = {
  readonly target: string
  readonly directory?: string
  readonly workspaceID?: Workspace.ID
}

export interface Interface {
  issue(input: Scope): Effect.Effect<typeof ConnectToken.Type>
  consume(input: Scope & { readonly ticket: string }): Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/PtyTicket") {}

function stored(scope: Scope): Stored {
  return {
    target: scope.ptyID !== undefined ? `pty:${scope.ptyID}` : `mcp:${scope.mcpClient}`,
    directory: scope.directory,
    workspaceID: scope.workspaceID,
  }
}

function matches(record: Stored, input: Stored) {
  return (
    record.target === input.target && record.directory === input.directory && record.workspaceID === input.workspaceID
  )
}

// Tickets are inserted via Cache.set and removed atomically via invalidateWhen. The lookup is
// never invoked; it dies if it ever is, which would signal a misuse of the Service interface.
const noLookup = () => Effect.die(new Error("PtyTicket cache must be used via set/invalidateWhen, never get"))

// Visible for tests so the TTL can be shortened. Production uses `layer` with the default TTL.
export const make = (ttl: Duration.Input = DEFAULT_TTL) =>
  Effect.gen(function* () {
    const cache = yield* Cache.make<string, Stored>({ capacity: CAPACITY, lookup: noLookup, timeToLive: ttl })
    const expiresIn = Math.max(1, Math.round(Duration.toSeconds(Duration.fromInputUnsafe(ttl))))
    return Service.of({
      issue: Effect.fn("PtyTicket.issue")(function* (input) {
        const ticket = crypto.randomUUID()
        yield* Cache.set(cache, ticket, stored(input))
        return { ticket, expires_in: expiresIn }
      }),
      consume: Effect.fn("PtyTicket.consume")(function* (input) {
        return yield* Cache.invalidateWhen(cache, input.ticket, (record) => matches(record, stored(input)))
      }),
    })
  })

const layer = Layer.effect(Service, make())

export const node = makeGlobalNode({ service: Service, layer: layer, deps: [] })
