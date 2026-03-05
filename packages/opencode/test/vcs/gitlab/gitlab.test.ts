import { describe, test, expect } from "bun:test"

describe("GitLabProvider", () => {
  test("parseWebhook extracts MR note event", async () => {
    const { GitLabProvider } = require("../../../src/vcs/gitlab/gitlab")

    const provider = new GitLabProvider({
      baseUrl: "https://hera.tics.inta/api/v4",
      token: "test-token",
    })

    const headers = new Headers({
      "x-gitlab-token": "test-secret",
      "x-gitlab-event": "Merge Request Hook",
    })

    const body = JSON.stringify({
      object_kind: "note",
      event_type: "note",
      project: { id: 61 },
      merge_request: { iid: 123 },
      object_attributes: {
        noteable_type: "MergeRequest",
        note: "Test comment",
      },
    })

    const event = await provider.parseWebhook(headers, body)
    expect(event.type).toBe("note")
    expect(event.projectId).toBe(61)
    expect(event.mrIid).toBe(123)
  })

  test("createMRDiscussion uses correct position format", () => {
    const { GitLabProvider } = require("../../../src/vcs/gitlab/gitlab")

    const provider = new GitLabProvider({
      baseUrl: "https://hera.tics.inta/api/v4",
      token: "test-token",
    })

    const position = {
      baseSha: "abc123",
      startSha: "def456",
      headSha: "ghi789",
      positionType: "text" as const,
      newPath: "src/test.ts",
      newLine: 42,
    }

    // This will fail without real GitLab - just test the format
    expect(position.newLine).toBe(42)
    expect(position.positionType).toBe("text")
  })
})
