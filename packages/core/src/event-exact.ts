import type { Data, Definition, Payload } from "@opencode-ai/schema/event"
import type { Event } from "@opencode-ai/schema/event"
import { Context, Effect } from "effect"

/**
 * Internal object capability for an exact durable event commit.
 *
 * The brand has no exported constructor.  A token is useful only to the EventV2 layer instance whose
 * private WeakMap contains that exact object; an empty object, copied metadata, or a token minted by a
 * different layer instance has no authority.
 */
declare const TokenType: unique symbol
export type Token = object & { readonly [TokenType]: true }

export type Coordinate = {
  readonly aggregateID: string
  readonly seq: number
}

export type Authority = {
  readonly instance: string
  readonly operation: string
  readonly repair: string
  readonly operationRevision: bigint
  readonly freezeOwner: string
  readonly generation: number
  readonly fact: string
  readonly pair: string
  readonly kind: "message" | "part"
}

export type IssueInput<D extends Definition> = {
  readonly definition: D
  readonly data: Data<D>
  readonly id: Event.ID
  readonly authority: Authority
  readonly expectedRow: unknown
  readonly retained?: Coordinate
  readonly projector: (event: Payload<D>) => Effect.Effect<void>
  readonly commit?: (seq: number) => Effect.Effect<void>
}

export type PublishResult<D extends Definition = Definition> = {
  readonly status: "committed_new" | "existing_exact"
  readonly coordinate: Coordinate
  readonly event: Payload<D>
}

export interface Interface {
  readonly issue: <D extends Definition>(input: IssueInput<D>) => Effect.Effect<Token>
  readonly publish: <D extends Definition>(token: Token) => Effect.Effect<PublishResult<D>, unknown>
}

/** Internal: deliberately absent from EventV2.Interface, Session APIs, HTTP, SDK, and plugins. */
export class Service extends Context.Service<Service, Interface>()("@opencode/EventExact") {}

export * as EventExact from "./event-exact"
