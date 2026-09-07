import { describe, expect, test } from "bun:test"
import type { APIEvent } from "@solidjs/start/server"
import { GET } from "../src/routes/oauth/opencode/client.json"

const fetchDocument = async (url: string) => {
  const response = GET({ request: new Request(url) } as APIEvent)
  return { response, body: await response.json() }
}

describe("OAuth client metadata document", () => {
  test("client_id equals the URL the document is served from", async () => {
    const url = "https://opencode.ai/oauth/opencode/client.json"
    const { response, body } = await fetchDocument(url)
    expect(response.status).toBe(200)
    expect(response.headers.get("Content-Type")).toBe("application/json")
    expect(body.client_id).toBe(url)
    expect(body.client_uri).toBe("https://opencode.ai")
  })

  test("follows the request origin on preview stages", async () => {
    const { body } = await fetchDocument("https://dev.opencode.ai/oauth/opencode/client.json?x=1")
    expect(body.client_id).toBe("https://dev.opencode.ai/oauth/opencode/client.json")
  })

  test("declares a public native client with portless loopback redirects", async () => {
    const { body } = await fetchDocument("https://opencode.ai/oauth/opencode/client.json")
    expect(body.application_type).toBe("native")
    expect(body.token_endpoint_auth_method).toBe("none")
    expect(body.redirect_uris).toEqual(["http://127.0.0.1/callback", "http://localhost/callback"])
    expect(body.grant_types).toEqual(["authorization_code", "refresh_token"])
    expect(body.response_types).toEqual(["code"])
  })
})
