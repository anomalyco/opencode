import { describe, expect, test } from "bun:test"
import { createHmac } from "node:crypto"
import { Effect } from "effect"
import { createWebhookServer, verifySignature } from "@/teamjules/webhook"
import type { TeamJules } from "@opencode-ai/core/teamjules"

describe("TeamJules Webhook", () => {
  const secret = "test-webhook-secret"

  test("verifySignature correctly verifies HMAC-SHA256 signatures", () => {
    const payload = JSON.stringify({ action: "created", comment: { body: "/jules fix bug" } })
    const validSignature = "sha256=" + createHmac("sha256", secret).update(payload).digest("hex")
    const invalidSignature = "sha256=" + "a".repeat(64)

    expect(verifySignature(payload, validSignature, secret)).toBe(true)
    expect(verifySignature(payload, invalidSignature, secret)).toBe(false)
    expect(verifySignature(payload, undefined, secret)).toBe(false)
    expect(verifySignature(payload + "tampered", validSignature, secret)).toBe(false)
  })

  test("webhook server handles health check, signature verification, and task creation", async () => {
    const createdTasks: Array<Parameters<TeamJules.Interface["createTask"]>[0]> = []
    const mockService = {
      createTask: (input: any) =>
        Effect.sync(() => {
          createdTasks.push(input)
          return { id: "tj_mock_123" } as any
        }),
    } as unknown as TeamJules.Interface

    const port = 30000 + Math.floor(Math.random() * 5000)
    const server = createWebhookServer(mockService, { port, secret })
    await server.listen()

    try {
      const baseUrl = `http://127.0.0.1:${port}`

      // 1. Health check
      const healthRes = await fetch(`${baseUrl}/webhook/health`)
      expect(healthRes.status).toBe(200)
      const healthData = await healthRes.json()
      expect(healthData).toEqual({ status: "ok" })

      // 2. Unauthorized request (invalid signature)
      const unauthRes = await fetch(`${baseUrl}/webhook/github`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-hub-signature-256": "sha256=" + "0".repeat(64),
        },
        body: JSON.stringify({ action: "created" }),
      })
      expect(unauthRes.status).toBe(401)

      // 3. Valid GitHub comment with /jules command
      const julesPayload = JSON.stringify({
        action: "created",
        comment: { body: "Hey @bot /jules implement new feature" },
        repository: { full_name: "test-owner/test-repo", default_branch: "dev" },
      })
      const julesSig = "sha256=" + createHmac("sha256", secret).update(julesPayload).digest("hex")

      const julesRes = await fetch(`${baseUrl}/webhook/github`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-hub-signature-256": julesSig,
        },
        body: julesPayload,
      })
      expect(julesRes.status).toBe(200)
      expect(await julesRes.text()).toBe("Task created")

      expect(createdTasks.length).toBe(1)
      expect(createdTasks[0]).toEqual({
        type: "issue",
        repo: "test-owner/test-repo",
        branch: "dev",
        prompt: "implement new feature",
      })

      // 4. Valid comment without /jules command
      const otherPayload = JSON.stringify({
        action: "created",
        comment: { body: "Just a regular comment" },
        repository: { full_name: "test-owner/test-repo", default_branch: "dev" },
      })
      const otherSig = "sha256=" + createHmac("sha256", secret).update(otherPayload).digest("hex")

      const otherRes = await fetch(`${baseUrl}/webhook/github`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-hub-signature-256": otherSig,
        },
        body: otherPayload,
      })
      expect(otherRes.status).toBe(200)
      expect(await otherRes.text()).toBe("OK")
      expect(createdTasks.length).toBe(1)

      // 5. Valid comment with /teamjules command
      const teamjulesPayload = JSON.stringify({
        action: "created",
        comment: { body: "/teamjules refactor auth service" },
        repository: { full_name: "test-owner/test-repo", default_branch: "main" },
      })
      const teamjulesSig = "sha256=" + createHmac("sha256", secret).update(teamjulesPayload).digest("hex")

      const teamjulesRes = await fetch(`${baseUrl}/webhook/github`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-hub-signature-256": teamjulesSig,
        },
        body: teamjulesPayload,
      })
      expect(teamjulesRes.status).toBe(200)
      expect(await teamjulesRes.text()).toBe("Task created")
      expect(createdTasks.length).toBe(2)
      expect(createdTasks[1].prompt).toBe("refactor auth service")

      // 6. Issue opened with /jules in description
      const issuePayload = JSON.stringify({
        action: "opened",
        issue: { body: "/jules add telemetry endpoints" },
        repository: { full_name: "test-owner/test-repo", default_branch: "main" },
      })
      const issueSig = "sha256=" + createHmac("sha256", secret).update(issuePayload).digest("hex")

      const issueRes = await fetch(`${baseUrl}/webhook/github`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-hub-signature-256": issueSig,
        },
        body: issuePayload,
      })
      expect(issueRes.status).toBe(200)
      expect(await issueRes.text()).toBe("Task created")
      expect(createdTasks.length).toBe(3)
      expect(createdTasks[2].prompt).toBe("add telemetry endpoints")
    } finally {
      await server.close()
    }
  })
})
