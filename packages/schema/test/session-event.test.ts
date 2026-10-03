import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { SessionEvent } from "../src/session-event"
import { ProjectID } from "../src/project-id"
import { AbsolutePath } from "../src/schema"

describe("SessionEvent.Moved schema", () => {
  test("encodes and decodes moved event with projectID", () => {
    const raw = {
      id: "evt_123",
      type: "session.next.moved",
      data: {
        timestamp: 1700000000000,
        sessionID: "ses_123",
        location: {
          directory: AbsolutePath.make("/path/to/new/repo"),
        },
        subdirectory: "sub",
        projectID: "proj_456",
      },
    }

    const decoded = Schema.decodeUnknownSync(SessionEvent.Moved)(raw)
    expect(decoded.data.projectID).toBe(ProjectID.make("proj_456"))
    expect(decoded.data.location.directory).toBe(AbsolutePath.make("/path/to/new/repo"))

    const encoded = Schema.encodeSync(SessionEvent.Moved)(decoded)
    expect(encoded.data.projectID).toBe("proj_456")
  })

  test("encodes and decodes moved event without optional projectID", () => {
    const raw = {
      id: "evt_123",
      type: "session.next.moved",
      data: {
        timestamp: 1700000000000,
        sessionID: "ses_123",
        location: {
          directory: AbsolutePath.make("/path/to/new/repo"),
        },
      },
    }

    const decoded = Schema.decodeUnknownSync(SessionEvent.Moved)(raw)
    expect(decoded.data.projectID).toBeUndefined()

    const encoded = Schema.encodeSync(SessionEvent.Moved)(decoded)
    expect(encoded.data.projectID).toBeUndefined()
  })
})
