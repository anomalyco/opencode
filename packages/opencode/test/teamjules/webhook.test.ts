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
      // No new task should be created
      expect(createdTasks.length).toBe(1)
    } finally {
      await server.close()
    }
  })
})
