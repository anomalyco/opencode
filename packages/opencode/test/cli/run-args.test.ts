import { describe, expect, test } from "bun:test"
import { createOpencodeClient } from "@opencode-ai/sdk/v2"

describe("cli.run --dir flag", () => {
  test("SDK adds x-opencode-directory header when directory is provided", async () => {
    let captured: Request | undefined

    const mockFetch = async (input: Request) => {
      captured = input
      return new Response(JSON.stringify({ data: { id: "test-session" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }

    const client = createOpencodeClient({
      baseUrl: "http://localhost:4096",
      directory: "/custom/project/path",
      fetch: mockFetch as typeof fetch,
    })

    await client.session.create()

    expect(captured).toBeDefined()
    expect(captured!.headers.get("x-opencode-directory")).toBe("/custom/project/path")
  })

  test("SDK does not add x-opencode-directory header when directory is not provided", async () => {
    let captured: Request | undefined

    const mockFetch = async (input: Request) => {
      captured = input
      return new Response(JSON.stringify({ data: { id: "test-session" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }

    const client = createOpencodeClient({
      baseUrl: "http://localhost:4096",
      fetch: mockFetch as typeof fetch,
    })

    await client.session.create()

    expect(captured).toBeDefined()
    expect(captured!.headers.get("x-opencode-directory")).toBeNull()
  })
})
