export * as AgentTunnel from "./agent-tunnel.js"

import { Schema } from "effect"
import { Agent } from "./agent.js"
import { NonNegativeInt, optional } from "./schema.js"
import { SessionID } from "./session-id.js"
import { SessionMessage } from "./session-message.js"

/** How a tunnel message routes: a peer message within the family, or a report up to an ancestor. */
export const Kind = Schema.Literals(["message", "report"]).annotate({ identifier: "AgentTunnel.Kind" })
export type Kind = typeof Kind.Type

const Endpoint = Schema.Struct({
  sessionID: SessionID,
  /** The endpoint's agent at send time; omitted when the session has none. */
  agent: Agent.ID.pipe(optional),
})

/**
 * One agent-tunnel message: the wire and storage record for a session-to-session send within a
 * family. `id` is the canonical `SessionMessage.ID` rather than a separate tunnel id: it doubles as
 * the synthetic inbox item id used for delivery, so inbox idempotency ("first admission wins for
 * matching session and type") applies to resent messages.
 */
export interface Message extends Schema.Schema.Type<typeof Message> {}
export const Message = Schema.Struct({
  id: SessionMessage.ID,
  from: Endpoint,
  to: Endpoint,
  kind: Kind,
  body: Schema.String,
  /** Epoch milliseconds. Event payloads stay JSON-shaped at runtime, like every other session event. */
  time: Schema.Struct({ created: NonNegativeInt }),
  /** The recipient session's durable event sequence; ascending within one recipient, and family queries order by `(time.created, sequence)`. */
  sequence: NonNegativeInt,
}).annotate({ identifier: "AgentTunnel.Message" })
