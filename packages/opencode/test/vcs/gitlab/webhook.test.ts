import { describe, test, expect } from "bun:test"

describe("GitLab Webhook Handler", () => {
  test("filters non-MR note events", async () => {
    const { handleGitLabWebhook } = require("../../../src/vcs/gitlab/webhook")

    const headers = new Headers({
      "x-gitlab-token": "test-secret",
      "x-gitlab-event": "Merge Request Hook",
    })

    const body = JSON.stringify({
      object_kind: "note",
      project: { id: 61 },
      merge_request: { iid: 123 },
      object_attributes: {
        noteable_type: "Issue", // Not MR
      },
    })

    const result = await handleGitLabWebhook(headers, body)
    expect(result.shouldProcess).toBe(false)
  })

  test("processes MR note events", async () => {
    const { handleGitLabWebhook } = require("../../../src/vcs/gitlab/webhook")

    const headers = new Headers({
      "x-gitlab-token": "test-secret",
      "x-gitlab-event": "Merge Request Hook",
    })

    const body = JSON.stringify({
      object_kind: "note",
      project: { id: 61 },
      merge_request: { iid: 123 },
      object_attributes: {
        noteable_type: "MergeRequest",
        note: "/oc summarize",
      },
      user: { username: "testuser", name: "Test User" },
    })

    const result = await handleGitLabWebhook(headers, body)
    expect(result.shouldProcess).toBe(true)
    expect(result.event?.projectId).toBe(61)
    expect(result.event?.mrIid).toBe(123)
  })

  test("rejects webhooks without token", async () => {
    const { handleGitLabWebhook } = require("../../../src/vcs/gitlab/webhook")

    const headers = new Headers({
      "x-gitlab-event": "Merge Request Hook",
    })

    const body = JSON.stringify({
      object_kind: "note",
    })

    const result = await handleGitLabWebhook(headers, body)
    expect(result.shouldProcess).toBe(false)
    expect(result.error).toBe("Missing X-Gitlab-Token header")
  })
})
