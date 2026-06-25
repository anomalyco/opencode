export * as PtyTicket from "./ticket"

import { WorkspaceV2 } from "../workspace"
import { PtyTicket } from "@opencode-ai/schema/pty-ticket"
import { PtyID } from "./schema"
import { Cache, Context, Duration, Effect, Layer } from "effect"
import { LayerNode } from "../effect/layer-node"

const DEFAULT_TTL = Duration.seconds(60)
const CAPACITY = 10_000

export const ConnectToken = PtyTicket.ConnectToken

export type Scope = {
  readonly ptyID: PtyID
  readonly directory?: string
  readonly workspaceID?: WorkspaceV2.ID
}

export interface Interface {
  issue(input: Scope): Effect.Effect<typeof ConnectToken.Type>
  consume(input: Scope & { readonly ticket: string }): Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/PtyTicket") {}

function matches(record: Scope, input: Scope) {
  return (
    record.ptyID === input.ptyID && record.directory === input.directory && record.workspaceID === input.workspaceID
  )
}

// Tickets are inserted via Cache.set and removed atomically via invalidateWhen. The lookup is
// never invoked; it dies if it ever is, which would signal a misuse of the Service interface.
const noLookup = () => Effect.die("PtyTicket cache must be used via set/invalidateWhen, never get")

// Visible for tests so the TTL can be shortened. Production uses `layer` with the default TTL.
export const make = (ttl: Duration.Input = DEFAULT_TTL) =>
  Effect.gen(function* () {
    const cache = yield* Cache.make<string, Scope>({ capacity: CAPACITY, lookup: noLookup, timeToLive: ttl })
    const expiresIn = Math.max(1, Math.round(Duration.toSeconds(Duration.fromInputUnsafe(ttl))))
    return Service.of({
      issue: Effect.fn("PtyTicket.issue")(function* (input) {
        const ticket = crypto.randomUUID()
        yield* Cache.set(cache, ticket, input)
        return { ticket, expires_in: expiresIn }
      }),
      consume: Effect.fn("PtyTicket.consume")(function* (input) {
        return yield* Cache.invalidateWhen(cache, input.ticket, (stored) => matches(stored, input))
      }),
    })
  })

export const layer = Layer.effect(Service, make())

export const defaultLayer = layer
export const node = LayerNode.make(layer, [])
