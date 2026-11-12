import { describe, expect, test } from "bun:test"
import { metaResponse } from "../src/lib/meta"

describe("machine-readable documents", () => {
  test("the OAuth client document names the URL it was fetched from", async () => {
    for (const origin of ["https://opencode.ai", "https://dev.opencode.ai"]) {
      const response = metaResponse(new Request(`${origin}/oauth/opencode/client.json?v=1`))
      expect(response?.status).toBe(200)
      expect(response?.headers.get("Content-Type")).toBe("application/json")
      expect(response?.headers.get("Cache-Control")).toBe("public, max-age=300")
      expect(response?.headers.get("Access-Control-Allow-Origin")).toBe("*")
      const document = await response?.json()
      expect(document.client_id).toBe(`${origin}/oauth/opencode/client.json`)
      expect(document.logo_uri).toBe(`${origin}/web-app-manifest-512x512.png`)
    }
  })

  test("the Apple app association opens only /pair", async () => {
    const response = metaResponse(new Request("https://opencode.ai/.well-known/apple-app-site-association"))
    expect(response?.headers.get("Content-Type")).toBe("application/json")
    expect(response?.headers.get("Cache-Control")).toBe("public, max-age=3600")
    const document = await response?.json()
    expect(document.applinks.details[0].components.map((component: { "/": string }) => component["/"])).toEqual([
      "/pair",
      "/pair/*",
    ])
  })

  test("other methods get a 404 and other paths pass through", () => {
    expect(
      metaResponse(new Request("https://opencode.ai/oauth/opencode/client.json", { method: "POST" }))?.status,
    ).toBe(404)
    expect(
      metaResponse(new Request("https://opencode.ai/oauth/opencode/client.json", { method: "HEAD" }))?.status,
    ).toBe(200)
    expect(metaResponse(new Request("https://opencode.ai/"))).toBeUndefined()
    expect(metaResponse(new Request("https://opencode.ai/config.json"))).toBeUndefined()
  })
})
