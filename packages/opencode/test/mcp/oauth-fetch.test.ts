import { describe, expect, test } from "bun:test"
import { oauthFetch } from "../../src/mcp/oauth-fetch"

const tokenEndpoint = "https://auth.example.com/token"
const refreshBody = (refreshToken: string) =>
  new URLSearchParams({
    grant_type: "refresh_token",
    client_id: "opencode",
    refresh_token: refreshToken,
  })

function serverWithRotatingRefresh(): { server: ReturnType<typeof Bun.serve>; rotated: string[] } {
  const rotated: string[] = []
  let generation = 0
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (request.method !== "POST" || new URL(request.url).pathname !== "/token")
        return new Response("Not found", { status: 404 })
      const body = await request.formData()
      const presented = body.get("refresh_token")
      // Rotating server: only the newest generation refreshes; older tokens are invalid_grant.
      if (presented !== rotated[rotated.length - 1])
        return Response.json({ error: "invalid_grant" }, { status: 400 })
      generation += 1
      const next = `refresh-generation-${generation}`
      rotated.push(next)
      return Response.json({
        access_token: `access-generation-${generation}`,
        token_type: "Bearer",
        expires_in: 600,
        refresh_token: next,
      })
    },
  })
  return { server, rotated }
}

describe("oauthFetch", () => {
  test("non-refresh requests pass through untouched", async () => {
    const seen: string[] = []
    const { server } = serverWithRotatingRefresh()
    try {
      const response = await oauthFetch(`${server.url.origin}/other`, { method: "GET" })
      seen.push(String(response.status))
      expect(response.status).toBe(404)
      expect(seen).toEqual(["404"])
    } finally {
      server.stop(true)
    }
  })

  test("concurrent refreshes of the same token share one request", async () => {
    const { server, rotated } = serverWithRotatingRefresh()
    try {
      rotated.push("refresh-generation-0")
      // Five parallel calls hit the transport at once after a batch of 401s; all carry the same
      // refresh token. A rotating server honors the first and rejects the rest as invalid_grant.
      const responses = await Promise.all(
        Array.from({ length: 5 }, () =>
          oauthFetch(`${server.url.origin}/token`, {
            method: "POST",
            body: refreshBody("refresh-generation-0"),
          }),
        ),
      )
      const shared = await responses[0]!.clone().json()
      expect(shared.access_token).toBe("access-generation-1")
      for (const response of responses) {
        const body = await response.clone().json()
        expect(body.error).toBeUndefined()
        expect(body.access_token).toBe("access-generation-1")
      }
      expect(rotated).toEqual(["refresh-generation-0", "refresh-generation-1"])
    } finally {
      server.stop(true)
    }
  })

  test("sequential refreshes with rotated tokens each hit the server", async () => {
    const { server, rotated } = serverWithRotatingRefresh()
    try {
      rotated.push("refresh-generation-0")
      const first = await oauthFetch(`${server.url.origin}/token`, {
        method: "POST",
        body: refreshBody("refresh-generation-0"),
      })
      const firstBody = await first.clone().json()
      expect(firstBody.refresh_token).toBe("refresh-generation-1")

      const second = await oauthFetch(`${server.url.origin}/token`, {
        method: "POST",
        body: refreshBody("refresh-generation-1"),
      })
      const secondBody = await second.clone().json()
      expect(secondBody.refresh_token).toBe("refresh-generation-2")
      expect(rotated).toEqual([
        "refresh-generation-0",
        "refresh-generation-1",
        "refresh-generation-2",
      ])
    } finally {
      server.stop(true)
    }
  })
})