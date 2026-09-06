import { describe, expect } from "bun:test"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { Effect, Layer } from "effect"
import { SessionClosureModel as Model } from "@/session/closure/model"
import { SessionClosureRecord } from "@/session/closure/record"
import { testEffect } from "../lib/effect"

const calls = {
  message: new Array<Parameters<SessionProjector.ClosureRecordInterface["message"]>[0]>(),
  part: new Array<Parameters<SessionProjector.ClosureRecordInterface["part"]>[0]>(),
}
const core = SessionProjector.ClosureRecordService.of({
  message: (input) =>
    Effect.sync(() => calls.message.push(input)).pipe(
      Effect.as({
        status: "committed_new",
        coordinate: { aggregateID: String(input.info.sessionID), seq: 0 },
        row: undefined as never,
      }),
    ),
  part: (input) =>
    Effect.sync(() => calls.part.push(input)).pipe(
      Effect.as({
        status: "committed_new",
        coordinate: { aggregateID: String(input.part.sessionID), seq: 1 },
        row: undefined as never,
      }),
    ),
  verify: () => Effect.void,
})
const it = testEffect(
  SessionClosureRecord.layer.pipe(Layer.provide(Layer.succeed(SessionProjector.ClosureRecordService, core))),
)

const record = (): Model.FrozenPair => {
  const identity: Model.Identity = {
    source: "session_identity",
    agent: "build",
    model: { providerID: "provider", modelID: "model", variant: { present: false } },
  }
  const fact: Model.FactView = {
    type: "edge",
    id: Model.id("fact", "fact_record"),
    key: "edge:record",
    subject: Model.id("session", "ses_child"),
    owner: Model.id("session", "ses_owner"),
    child: Model.id("session", "ses_child"),
    outcome: "completed",
    yielded: false,
  }
  const pair = {
    fact,
    freezeOwner: Model.id("operation", "op_record"),
    generation: 1,
    identity,
    message: Model.id("message", "msg_record"),
    part: Model.id("part", "prt_record"),
    messageEvent: Model.id("event", "evt_record_message"),
    partEvent: Model.id("event", "evt_record_part"),
    messageTime: 100,
    partTime: 101,
    synthetic: true as const,
    text: "[Branch closure] frozen",
    metadata: {
      version: 1 as const,
      freeze_owner_operation_id: Model.id("operation", "op_record"),
      generation: 1,
      fact_key: "edge:record",
      identity_source: "session_identity" as const,
      record_kind: "edge" as const,
      subject_session_id: Model.id("session", "ses_child"),
      owner_session_id: Model.id("session", "ses_owner"),
      child_session_id: Model.id("session", "ses_child"),
      terminal_outcome: "completed" as const,
    },
  }
  return {
    ...pair,
    messageBytes: JSON.stringify({
      id: pair.message,
      event: pair.messageEvent,
      time: pair.messageTime,
      synthetic: true,
      identity,
    }),
    partBytes: JSON.stringify({
      id: pair.part,
      event: pair.partEvent,
      time: pair.partTime,
      synthetic: true,
      text: pair.text,
      metadata: pair.metadata,
    }),
  }
}

const command = {
  type: "pair.write" as const,
  instance: Model.id("instance", "instance_record"),
  permit: Model.id("pair", "pair_record"),
  candidate: {
    type: "pair.candidate" as const,
    instance: Model.id("instance", "instance_record"),
    operation: Model.id("operation", "op_record"),
    repair: Model.id("repair", "repair_record"),
    revision: 7n,
    freezeOwner: Model.id("operation", "op_record"),
    generation: 1,
    fact: Model.id("fact", "fact_record"),
    expectedPrefix: 0,
  },
}

describe("closure.record", () => {
  it.effect("writes the exact owner transcript Message before Part and rejects drift before either", () =>
    Effect.gen(function* () {
      calls.message.length = 0
      calls.part.length = 0
      const service = yield* SessionClosureRecord.Service
      expect(yield* service.write({ command, record: record() })).toEqual({ message: "verified", part: "verified" })
      expect(calls.message).toHaveLength(1)
      expect(calls.part).toHaveLength(1)
      expect(String(calls.message[0]?.info.sessionID)).toBe("ses_owner")
      expect(String(calls.part[0]?.part.messageID)).toBe("msg_record")
      // The literal is deliberate rather than the exported constant: this key is written into part
      // metadata and persists in user databases, so the assertion pins the exact wire value. Reusing
      // the constant would keep passing if the constant itself changed.
      expect(calls.part[0]?.part.metadata).toEqual({ "opencode.branch_closure": record().metadata })
      expect(calls.message[0]?.authority.pair).toBe("pair_record")
      expect(calls.part[0]?.authority.pair).toBe("pair_record")

      const drifted = { ...record(), messageBytes: "{}" }
      expect(yield* service.write({ command, record: drifted })).toEqual({ message: "failed", part: "absent" })
      expect(calls.message).toHaveLength(1)
      expect(calls.part).toHaveLength(1)

      const wrongFact = { ...command, candidate: { ...command.candidate, fact: Model.id("fact", "fact_other") } }
      expect(yield* service.write({ command: wrongFact, record: record() })).toEqual({
        message: "failed",
        part: "absent",
      })
      expect(calls.message).toHaveLength(1)
      expect(calls.part).toHaveLength(1)
    }),
  )
})
