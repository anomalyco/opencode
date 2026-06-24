import { describe, expect, test } from "bun:test"
import { LegacyEvent } from "../src/legacy-event"
import { PermissionV1 } from "../src/permission-v1"
import { QuestionV1 } from "../src/question-v1"
import { SessionV1 } from "../src/session-v1"

describe("legacy public event schemas", () => {
  test("keeps the seven durable SessionV1 definitions", () => {
    expect(SessionV1.Events.map((event) => event.type)).toEqual([
      "session.created",
      "session.updated",
      "session.deleted",
      "message.updated",
      "message.removed",
      "message.part.updated",
      "message.part.removed",
    ])
    expect(SessionV1.Events.every((event) => event.durable?.aggregate === "sessionID")).toBe(true)
    expect(SessionV1.Events.every((event) => event.durable?.version === 1)).toBe(true)
  })

  test("owns the legacy transient public definitions", () => {
    expect([
      SessionV1.PartDelta.type,
      SessionV1.Diff.type,
      SessionV1.Error.type,
      PermissionV1.Event.Asked.type,
      PermissionV1.Event.Replied.type,
      QuestionV1.Event.Asked.type,
      QuestionV1.Event.Replied.type,
      QuestionV1.Event.Rejected.type,
      LegacyEvent.ProjectUpdated.type,
      LegacyEvent.CommandExecuted.type,
    ]).toEqual([
      "message.part.delta",
      "session.diff",
      "session.error",
      "permission.asked",
      "permission.replied",
      "question.asked",
      "question.replied",
      "question.rejected",
      "project.updated",
      "command.executed",
    ])
  })
})
