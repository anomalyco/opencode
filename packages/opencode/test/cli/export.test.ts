import { describe, expect, test } from "bun:test"
import { ProjectV2 } from "@opencode-ai/core/project"
import { sanitize } from "../../src/cli/cmd/export"
import { SessionID } from "../../src/session/schema"
import type { Session } from "../../src/session/session"

function exportData(path: string) {
  const sessionID = SessionID.descending()
  return {
    sessionID,
    data: {
      info: {
        id: sessionID,
        slug: "test-session",
        projectID: ProjectV2.ID.global,
        directory: path,
        path,
        title: "Test session",
        version: "1.0.0",
        time: {
          created: 1,
          updated: 2,
        },
      } satisfies Session.Info,
      messages: [],
    },
  }
}

const paths = ["/Users/alice/repo", "C:\\Users\\Alice\\repo"]

describe("export sanitize", () => {
  paths.forEach((path) => {
    test(`redacts top-level session path ${path}`, () => {
      const input = exportData(path)
      const sanitized = sanitize(input.data)

      expect(sanitized.info.directory).toBe(`[redacted:session-directory:${input.sessionID}]`)
      expect(sanitized.info.path).toBe(`[redacted:session-path:${input.sessionID}]`)
      expect(JSON.stringify(sanitized)).not.toContain(path)
    })
  })
})
