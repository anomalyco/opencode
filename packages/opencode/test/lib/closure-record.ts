import { CLOSURE_RECORD_METADATA_KEY, isCompleteClosurePair } from "@opencode-ai/core/session/closure-record"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Database } from "@opencode-ai/core/database/database"
import { MessageTable, PartTable } from "@opencode-ai/core/session/sql"
import { Effect } from "effect"

type Identity = {
  agent?: string
  providerID?: string
  modelID?: string
  variant?: string
}

type Coordinate = Identity & {
  sessionID?: string
  messageID?: string
  partID?: string
  sourceUserMessageID?: string
  created?: number
  terminalOutcome?: "cancelled" | "completed" | "error" | "unknown"
}

export type UserWithParts = {
  info: SessionV1.User
  parts: SessionV1.Part[]
}

/**
 * Test-fixture seam for rows that PRE-DATE the reserved-key provenance guard.
 *
 * Consumer tests need malformed lookalikes and authentic historical records already at rest. They
 * must not manufacture those rows through the generic production writer now being tested to reject
 * them. Direct row seeding is intentionally test-only and grants no runtime replication authority.
 */
export const persistHistoricalMessage = Effect.fn("ClosureRecordFixture.persistHistoricalMessage")(function* <
  T extends SessionV1.WithParts,
>(message: T) {
  const database = yield* Database.Service
  const messageData = { ...message.info } as Record<string, unknown>
  delete messageData.id
  delete messageData.sessionID
  yield* database.db
    .insert(MessageTable)
    .values({
      id: message.info.id,
      session_id: message.info.sessionID,
      time_created: message.info.time.created,
      time_updated: message.info.time.created,
      data: messageData as never,
    })
    .run()
    .pipe(Effect.orDie)
  for (const part of message.parts) {
    const partData = { ...part } as Record<string, unknown>
    delete partData.id
    delete partData.messageID
    delete partData.sessionID
    yield* database.db
      .insert(PartTable)
      .values({
        id: part.id,
        message_id: part.messageID,
        session_id: part.sessionID,
        time_created: message.info.time.created,
        time_updated: message.info.time.created,
        data: partData as never,
      })
      .run()
      .pipe(Effect.orDie)
  }
  return message
})

export function closureRecord(input: Coordinate = {}): UserWithParts {
  const sessionID = SessionID.make(input.sessionID ?? "ses_closure")
  const messageID = MessageID.make(input.messageID ?? "msg_closure")
  const partID = PartID.make(input.partID ?? "prt_closure")
  const terminalOutcome = input.terminalOutcome ?? "cancelled"
  const sentence =
    terminalOutcome === "cancelled"
      ? "Cancellation won physical closure."
      : terminalOutcome === "completed"
        ? "The tracked execution completed before cancellation took effect."
        : terminalOutcome === "error"
          ? "The tracked execution ended with an error before cancellation took effect."
          : "The terminal outcome could not be established."
  const info: SessionV1.User = {
    id: messageID,
    sessionID,
    role: "user",
    time: { created: input.created ?? 4 },
    agent: input.agent ?? "copied-closure",
    model: {
      providerID: ProviderV2.ID.make(input.providerID ?? "copied-provider"),
      modelID: ModelV2.ID.make(input.modelID ?? "copied-model"),
      ...(input.variant === undefined ? {} : { variant: input.variant }),
    },
  }
  const part: SessionV1.TextPart = {
    id: partID,
    sessionID,
    messageID,
    type: "text",
    text: `[Branch closure] This Session's prior Task execution: ${sentence}`,
    synthetic: true,
    metadata: {
      [CLOSURE_RECORD_METADATA_KEY]: {
        version: 1,
        freeze_owner_operation_id: "operation-1",
        generation: 1,
        fact_key: "self:ses_closure",
        identity_source: "prior_user_message",
        source_user_message_id: input.sourceUserMessageID ?? "msg_source",
        record_kind: "self",
        subject_session_id: sessionID,
        terminal_outcome: terminalOutcome,
      },
    },
  }
  const result = { info, parts: [part] }
  if (!isCompleteClosurePair(result)) throw new Error("test fixture is not a complete closure pair")
  return result
}

export function ordinaryUser(input: Coordinate & { text?: string; synthetic?: boolean } = {}): UserWithParts {
  const sessionID = SessionID.make(input.sessionID ?? "ses_closure")
  const messageID = MessageID.make(input.messageID ?? "msg_ordinary")
  const info: SessionV1.User = {
    id: messageID,
    sessionID,
    role: "user",
    time: { created: input.created ?? 1 },
    agent: input.agent ?? "ordinary",
    model: {
      providerID: ProviderV2.ID.make(input.providerID ?? "ordinary-provider"),
      modelID: ModelV2.ID.make(input.modelID ?? "ordinary-model"),
      ...(input.variant === undefined ? {} : { variant: input.variant }),
    },
  }
  return {
    info,
    parts: [
      {
        id: PartID.make(input.partID ?? `prt_${messageID}`),
        sessionID,
        messageID,
        type: "text",
        text: input.text ?? "ordinary prompt",
        ...(input.synthetic === undefined ? {} : { synthetic: input.synthetic }),
      },
    ],
  }
}

export function wrongTextLookalike(input: Coordinate = {}): UserWithParts {
  const result = structuredClone(closureRecord(input))
  const part = result.parts[0]
  if (part?.type === "text") part.text += " altered"
  return result
}

export function multipartPartial(input: Coordinate = {}): UserWithParts {
  const result = structuredClone(closureRecord(input))
  const part = result.parts[0]
  if (part?.type !== "text") return result
  result.parts.push({
    ...part,
    id: PartID.make(`${part.id}_extra`),
    text: "generic synthetic companion",
    metadata: undefined,
  })
  return result
}
