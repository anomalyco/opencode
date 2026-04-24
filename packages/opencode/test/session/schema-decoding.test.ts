import { describe, expect, test } from "bun:test"
import { Schema } from "effect"

import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionRevert } from "../../src/session/revert"
import { SessionStatus } from "../../src/session/status"
import { SessionSummary } from "../../src/session/summary"
import { Todo } from "../../src/session/todo"
import { SessionID, MessageID, PartID } from "../../src/session/schema"
import { ProjectID } from "../../src/project/schema"
import { WorkspaceID } from "../../src/control-plane/schema"

// Covers the session-domain Effect Schema migration. For each migrated
// schema we assert:
//   1. The Effect decoder (`Schema.decodeUnknownSync`) accepts valid input.
//   2. The derived Zod (`X.zod.parse`) accepts the same input and returns the
//      same shape.
//   3. Clearly-invalid input is rejected by both paths.
//
// The point is to lock down the Schema <-> Zod bridge so a future edit to
// any input schema can't silently drop or widen a field on one side.

// Representative valid IDs — the branded schemas require the right prefix
// (see src/id/id.ts).
const sessionID = SessionID.zod.parse("ses_01J5Y5H0AH4Q4NXJ6P4C3P5V2K")
const sessionIDChild = SessionID.zod.parse("ses_01J5Y5H0AH4Q4NXJ6P4C3P5V2L")
const messageID = MessageID.zod.parse("msg_01J5Y5H0AH4Q4NXJ6P4C3P5V2M")
const partID = PartID.zod.parse("prt_01J5Y5H0AH4Q4NXJ6P4C3P5V2N")
const projectID = ProjectID.zod.parse("proj-alpha")
const workspaceID = WorkspaceID.zod.parse("wrk-primary")

function decodeUnknown<S extends Schema.Top>(schema: S) {
  const decode = Schema.decodeUnknownSync(schema as any)
  return (input: unknown): Schema.Schema.Type<S> => decode(input) as Schema.Schema.Type<S>
}

describe("Session.Info", () => {
  const decode = decodeUnknown(Session.Info)

  test("accepts minimal session", () => {
    const input = {
      id: sessionID,
      slug: "hello",
      projectID,
      directory: "/tmp/proj",
      title: "First session",
      version: "0.1.0",
      time: { created: 1, updated: 2 },
    }
    expect(decode(input)).toEqual(input)
    expect(Session.Info.zod.parse(input)).toEqual(input)
  })

  test("round-trips every optional field", () => {
    const input = {
      id: sessionID,
      slug: "fullshape",
      projectID,
      workspaceID,
      directory: "/tmp/proj",
      parentID: sessionIDChild,
      summary: {
        additions: 10,
        deletions: 5,
        files: 2,
        diffs: [{ additions: 1, deletions: 0, file: "a.ts", patch: "--- a/a.ts" }],
      },
      share: { url: "https://share.example.com/s/1" },
      title: "Full session",
      version: "1.0.0",
      time: { created: 100, updated: 200, compacting: 150, archived: 300 },
      permission: [{ action: "allow" as const, pattern: "*", permission: "read" }],
      revert: {
        messageID,
        partID,
        snapshot: "snap-1",
        diff: "diff-1",
      },
    }
    expect(decode(input)).toEqual(input)
    expect(Session.Info.zod.parse(input)).toEqual(input)
  })

  test("rejects unbranded session id", () => {
    const bad = { id: "not-a-session-id" } as unknown
    expect(() => decode(bad)).toThrow()
    expect(() => Session.Info.zod.parse(bad)).toThrow()
  })

  test("rejects missing required fields", () => {
    const bad = { id: sessionID } as unknown
    expect(() => decode(bad)).toThrow()
    expect(() => Session.Info.zod.parse(bad)).toThrow()
  })
})

describe("Session.ProjectInfo", () => {
  const decode = decodeUnknown(Session.ProjectInfo)

  test("accepts with and without optional name", () => {
    const noName = { id: projectID, worktree: "/tmp/wt" }
    const withName = { ...noName, name: "alpha" }
    expect(decode(noName)).toEqual(noName)
    expect(decode(withName)).toEqual(withName)
    expect(Session.ProjectInfo.zod.parse(noName)).toEqual(noName)
    expect(Session.ProjectInfo.zod.parse(withName)).toEqual(withName)
  })
})

describe("Session.GlobalInfo", () => {
  const decode = decodeUnknown(Session.GlobalInfo)

  test("accepts null project", () => {
    const input = {
      id: sessionID,
      slug: "global",
      projectID,
      directory: "/tmp/proj",
      title: "global",
      version: "0",
      time: { created: 0, updated: 0 },
      project: null,
    }
    expect(decode(input)).toEqual(input)
    expect(Session.GlobalInfo.zod.parse(input)).toEqual(input)
  })

  test("accepts populated project", () => {
    const input = {
      id: sessionID,
      slug: "global",
      projectID,
      directory: "/tmp/proj",
      title: "global",
      version: "0",
      time: { created: 0, updated: 0 },
      project: { id: projectID, worktree: "/tmp/wt", name: "alpha" },
    }
    expect(decode(input)).toEqual(input)
    expect(Session.GlobalInfo.zod.parse(input)).toEqual(input)
  })
})

describe("Session input schemas", () => {
  test("CreateInput accepts undefined and populated forms", () => {
    const decode = decodeUnknown(Session.CreateInput)
    expect(decode(undefined)).toBeUndefined()
    expect(Session.CreateInput.zod.parse(undefined)).toBeUndefined()

    const populated = {
      parentID: sessionID,
      title: "child",
      permission: [{ action: "ask" as const, pattern: "*", permission: "bash" }],
      workspaceID,
    }
    expect(decode(populated)).toEqual(populated)
    expect(Session.CreateInput.zod.parse(populated)).toEqual(populated)
  })

  test("ForkInput round-trips", () => {
    const decode = decodeUnknown(Session.ForkInput)
    const input = { sessionID, messageID }
    expect(decode(input)).toEqual(input)
    expect(Session.ForkInput.zod.parse(input)).toEqual(input)
    // messageID is optional
    const bare = { sessionID }
    expect(decode(bare)).toEqual(bare)
    expect(Session.ForkInput.zod.parse(bare)).toEqual(bare)
  })

  test("SetTitleInput rejects missing title", () => {
    expect(() => decodeUnknown(Session.SetTitleInput)({ sessionID })).toThrow()
    expect(() => Session.SetTitleInput.zod.parse({ sessionID })).toThrow()
  })

  test("SetArchivedInput accepts both with and without time", () => {
    const decode = decodeUnknown(Session.SetArchivedInput)
    expect(decode({ sessionID })).toEqual({ sessionID })
    expect(decode({ sessionID, time: 123 })).toEqual({ sessionID, time: 123 })
  })

  test("SetPermissionInput requires a ruleset", () => {
    const decode = decodeUnknown(Session.SetPermissionInput)
    const input = { sessionID, permission: [{ action: "deny" as const, pattern: "*", permission: "write" }] }
    expect(decode(input)).toEqual(input)
    expect(() => decode({ sessionID })).toThrow()
  })

  test("MessagesInput accepts optional limit", () => {
    const decode = decodeUnknown(Session.MessagesInput)
    expect(decode({ sessionID })).toEqual({ sessionID })
    expect(decode({ sessionID, limit: 50 })).toEqual({ sessionID, limit: 50 })
  })
})

describe("SessionRevert.RevertInput", () => {
  const decode = decodeUnknown(SessionRevert.RevertInput)

  test("messageID is required, partID is optional", () => {
    const withPart = { sessionID, messageID, partID }
    expect(decode(withPart)).toEqual(withPart)
    expect(SessionRevert.RevertInput.zod.parse(withPart)).toEqual(withPart)

    const noPart = { sessionID, messageID }
    expect(decode(noPart)).toEqual(noPart)
    expect(SessionRevert.RevertInput.zod.parse(noPart)).toEqual(noPart)

    expect(() => decode({ sessionID })).toThrow()
    expect(() => SessionRevert.RevertInput.zod.parse({ sessionID })).toThrow()
  })
})

describe("SessionSummary.DiffInput", () => {
  const decode = decodeUnknown(SessionSummary.DiffInput)

  test("messageID optional", () => {
    expect(decode({ sessionID })).toEqual({ sessionID })
    expect(decode({ sessionID, messageID })).toEqual({ sessionID, messageID })
  })
})

describe("SessionStatus.Info", () => {
  const decode = decodeUnknown(SessionStatus.Info)

  test("idle / busy discriminators", () => {
    expect(decode({ type: "idle" })).toEqual({ type: "idle" })
    expect(decode({ type: "busy" })).toEqual({ type: "busy" })
    expect(SessionStatus.Info.zod.parse({ type: "idle" })).toEqual({ type: "idle" })
  })

  test("retry carries attempt/message/next", () => {
    const input = { type: "retry" as const, attempt: 1, message: "transient", next: 500 }
    expect(decode(input)).toEqual(input)
    expect(SessionStatus.Info.zod.parse(input)).toEqual(input)
  })

  test("rejects unknown type", () => {
    expect(() => decode({ type: "bogus" })).toThrow()
    expect(() => SessionStatus.Info.zod.parse({ type: "bogus" })).toThrow()
  })
})

describe("Todo.Info", () => {
  const decode = decodeUnknown(Todo.Info)

  test("three-field round-trip", () => {
    const input = { content: "do a thing", status: "pending", priority: "high" }
    expect(decode(input)).toEqual(input)
    expect(Todo.Info.zod.parse(input)).toEqual(input)
  })
})

describe("SessionPrompt input schemas", () => {
  test("LoopInput is just sessionID", () => {
    const decode = decodeUnknown(SessionPrompt.LoopInput)
    expect(decode({ sessionID })).toEqual({ sessionID })
    expect(SessionPrompt.LoopInput.zod.parse({ sessionID } as unknown)).toEqual({ sessionID })
  })

  test("ShellInput requires agent + command", () => {
    const decode = decodeUnknown(SessionPrompt.ShellInput)
    const expected = { sessionID, agent: "build", command: "echo hi" }
    const input: unknown = expected
    expect(decode(input)).toEqual(expected)
    expect(SessionPrompt.ShellInput.zod.parse(input as unknown)).toEqual(expected)
    expect(() => decode({ sessionID })).toThrow()
  })

  test("PromptInput accepts a text part and a file part", () => {
    const decode = decodeUnknown(SessionPrompt.PromptInput)
    const expected = {
      sessionID,
      parts: [
        { type: "text" as const, text: "hello" },
        { type: "file" as const, mime: "image/png", url: "data:image/png;base64,AAAA" },
      ],
    }
    const input: unknown = expected
    const decoded = decode(input)
    expect(decoded.parts).toHaveLength(2)
    expect(decoded.parts[0]).toMatchObject({ type: "text", text: "hello" })
    expect(decoded.parts[1]).toMatchObject({ type: "file", mime: "image/png" })

    const viaZod = SessionPrompt.PromptInput.zod.parse(input)
    expect(viaZod.parts).toHaveLength(2)
  })

  test("PromptInput rejects unknown part type", () => {
    const decode = decodeUnknown(SessionPrompt.PromptInput)
    const bad = {
      sessionID,
      parts: [{ type: "nonsense", payload: 42 }],
    }
    expect(() => decode(bad)).toThrow()
    expect(() => SessionPrompt.PromptInput.zod.parse(bad)).toThrow()
  })

  test("CommandInput round-trips core fields", () => {
    const decode = decodeUnknown(SessionPrompt.CommandInput)
    const expected = {
      sessionID,
      arguments: "--flag",
      command: "deploy",
    }
    const input: unknown = expected
    expect(decode(input)).toEqual(expected)
    expect(SessionPrompt.CommandInput.zod.parse(input)).toEqual(expected)
  })
})
