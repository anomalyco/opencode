import { describe, expect, test } from "bun:test"
import { Elicitation } from "../../src/mcp/elicitation"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { tmpdir } from "../fixture/fixture"
import type { ElicitRequest } from "@modelcontextprotocol/sdk/types.js"

// Helper to create a valid ElicitRequest
function createElicitRequest(message: string = "Test message"): ElicitRequest {
  return {
    method: "elicitation/create",
    params: {
      message,
      requestedSchema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            title: "Name",
          },
        },
        required: ["name"],
      },
    },
  }
}

describe("mcp.elicitation.list endpoint", () => {
  test("should return 200 with empty array when no pending", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const response = await app.request("/mcp/elicitation", {
          method: "GET",
          headers: { "x-opencode-directory": tmp.path },
        })

        expect(response.status).toBe(200)
        const body = await response.json()
        expect(body).toEqual([])
      },
    })
  })

  test("should return 200 with pending elicitations", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Create a pending elicitation
        Elicitation.handle("test-server", createElicitRequest("Test message"))

        const app = Server.App()
        const response = await app.request("/mcp/elicitation", {
          method: "GET",
          headers: { "x-opencode-directory": tmp.path },
        })

        expect(response.status).toBe(200)
        const body = (await response.json()) as Elicitation.Request[]
        expect(body.length).toBe(1)
        expect(body[0].message).toBe("Test message")
        expect(body[0].serverName).toBe("test-server")
      },
    })
  })
})

describe("mcp.elicitation.reply endpoint", () => {
  test("should return 200 when replying to pending elicitation", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Create a pending elicitation
        Elicitation.handle("test-server", createElicitRequest())
        const pending = await Elicitation.list()
        const id = pending[0].id

        const app = Server.App()
        const response = await app.request(`/mcp/elicitation/${id}/reply`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-opencode-directory": tmp.path },
          body: JSON.stringify({ content: { name: "Test User" } }),
        })

        expect(response.status).toBe(200)
        const body = await response.json()
        expect(body).toBe(true)

        // Verify it was removed from pending
        const pendingAfter = await Elicitation.list()
        expect(pendingAfter.length).toBe(0)
      },
    })
  })

  test("should return 200 even for unknown elicitation id", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const response = await app.request("/mcp/elicitation/elicitation_unknown/reply", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-opencode-directory": tmp.path },
          body: JSON.stringify({ content: { name: "Test" } }),
        })

        // Currently returns 200 even for unknown (logs warning but doesn't error)
        expect(response.status).toBe(200)
      },
    })
  })

  test("should return 400 for invalid content", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const response = await app.request("/mcp/elicitation/elicitation_test/reply", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-opencode-directory": tmp.path },
          body: JSON.stringify({ content: "invalid" }), // Should be object
        })

        expect(response.status).toBe(400)
      },
    })
  })

  test("should return 400 for missing content", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const response = await app.request("/mcp/elicitation/elicitation_test/reply", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-opencode-directory": tmp.path },
          body: JSON.stringify({}),
        })

        expect(response.status).toBe(400)
      },
    })
  })
})

describe("mcp.elicitation.reject endpoint", () => {
  test("should return 200 when rejecting with decline action", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Create a pending elicitation
        Elicitation.handle("test-server", createElicitRequest())
        const pending = await Elicitation.list()
        const id = pending[0].id

        const app = Server.App()
        const response = await app.request(`/mcp/elicitation/${id}/reject`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-opencode-directory": tmp.path },
          body: JSON.stringify({ action: "decline" }),
        })

        expect(response.status).toBe(200)
        const body = await response.json()
        expect(body).toBe(true)

        // Verify it was removed from pending
        const pendingAfter = await Elicitation.list()
        expect(pendingAfter.length).toBe(0)
      },
    })
  })

  test("should return 200 when rejecting with cancel action", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Create a pending elicitation
        Elicitation.handle("test-server", createElicitRequest())
        const pending = await Elicitation.list()
        const id = pending[0].id

        const app = Server.App()
        const response = await app.request(`/mcp/elicitation/${id}/reject`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-opencode-directory": tmp.path },
          body: JSON.stringify({ action: "cancel" }),
        })

        expect(response.status).toBe(200)

        // Verify it was removed from pending
        const pendingAfter = await Elicitation.list()
        expect(pendingAfter.length).toBe(0)
      },
    })
  })

  test("should return 200 even for unknown elicitation id", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const response = await app.request("/mcp/elicitation/elicitation_unknown/reject", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-opencode-directory": tmp.path },
          body: JSON.stringify({ action: "cancel" }),
        })

        // Currently returns 200 even for unknown (logs warning but doesn't error)
        expect(response.status).toBe(200)
      },
    })
  })

  test("should return 400 for invalid action", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const response = await app.request("/mcp/elicitation/elicitation_test/reject", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-opencode-directory": tmp.path },
          body: JSON.stringify({ action: "invalid" }),
        })

        expect(response.status).toBe(400)
      },
    })
  })

  test("should return 400 for missing action", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const response = await app.request("/mcp/elicitation/elicitation_test/reject", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-opencode-directory": tmp.path },
          body: JSON.stringify({}),
        })

        expect(response.status).toBe(400)
      },
    })
  })
})
