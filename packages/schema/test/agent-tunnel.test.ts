import { describe, expect, test } from "bun:test"
import { DateTime, Schema } from "effect"
import { Agent } from "../src/agent.js"
import { AgentTunnel } from "../src/agent-tunnel.js"
import { DurableEventManifest } from "../src/durable-event-manifest.js"
import { SessionID } from "../src/session-id.js"
import { SessionEvent } from "../src/session-event.js"
import { SessionMessage } from "../src/session-message.js"

const encoded = {
  id: "msg_tunnel",
  from: { sessionID: "ses_sender", agent: "build" },
  to: { sessionID: "ses_recipient" },
  kind: "report" as const,
  body: "landed the contract",
  time: { created: 1 },
  sequence: 4,
}

describe("agent tunnel", () => {
  test("message round-trips and omits absent optional agents", () => {
    const message = Schema.decodeUnknownSync(AgentTunnel.Message)(encoded)
    expect(Schema.encodeSync(AgentTunnel.Message)(message)).toEqual(encoded)

    expect(
      Schema.encodeSync(AgentTunnel.Message)({
        id: SessionMessage.ID.make("msg_tunnel"),
        from: { sessionID: SessionID.make("ses_sender"), agent: undefined },
        to: { sessionID: SessionID.make("ses_recipient"), agent: Agent.ID.make("plan") },
        kind: "message",
        body: "handoff",
        time: { created: DateTime.makeUnsafe(2) },
        sequence: 0,
      }),
    ).toEqual({
      id: "msg_tunnel",
      from: { sessionID: "ses_sender" },
      to: { sessionID: "ses_recipient", agent: "plan" },
      kind: "message",
      body: "handoff",
      time: { created: 2 },
      sequence: 0,
    })
  })

  test("kind admits message and report only", () => {
    const decode = Schema.decodeUnknownSync(AgentTunnel.Kind)
    expect(decode("message")).toBe("message")
    expect(decode("report")).toBe("report")
    expect(() => decode("broadcast")).toThrow()
  })

  test("message reuses the canonical session message id", () => {
    expect(AgentTunnel.Message.fields.id).toBe(SessionMessage.ID)
    expect(AgentTunnel.Message.ast.annotations?.identifier).toBe("AgentTunnel.Message")
    expect(AgentTunnel.Kind.ast.annotations?.identifier).toBe("AgentTunnel.Kind")
  })

  test("tunnel sent is a durable recipient-scoped event", () => {
    expect(SessionEvent.TunnelSent.type).toBe("session.tunnel.sent")
    expect(SessionEvent.TunnelSent.durability).toBe("durable")
    expect(SessionEvent.TunnelSent.durable).toEqual({ aggregate: "sessionID", version: 1 })
    expect(DurableEventManifest.Durable.get("session.tunnel.sent.1")).toBe(SessionEvent.TunnelSent)
    expect(SessionEvent.Definitions).toContain(SessionEvent.TunnelSent)
  })

  test("tunnel sent round-trips through the durable union", () => {
    const event = {
      id: "evt_tunnel",
      created: 1,
      type: "session.tunnel.sent" as const,
      durable: { aggregateID: "ses_recipient", seq: 4, version: 1 },
      data: { sessionID: "ses_recipient", message: encoded },
    }
    const decoded = Schema.decodeUnknownSync(SessionEvent.TunnelSent)(event)

    expect(Schema.decodeUnknownSync(SessionEvent.Durable)(event).type).toBe("session.tunnel.sent")
    expect(Schema.encodeSync(AgentTunnel.Message)(decoded.data.message)).toEqual(encoded)
    expect(Schema.encodeSync(SessionEvent.TunnelSent)(decoded)).toEqual(event)
  })
})
