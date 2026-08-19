import { describe, expect, test } from "bun:test"
import { model } from "../../src/providers/cloudflare-workers-ai"

describe("Cloudflare Workers AI provider package", () => {
  test("derives the endpoint from accountId", () => {
    const resolved = model("@cf/model", { accountId: "account", apiKey: "secret" })

    expect(resolved.route.endpoint.baseURL).toBe("https://api.cloudflare.com/client/v4/accounts/account/ai/v1")
  })

  test("preserves an explicit endpoint", () => {
    const resolved = model("@cf/model", { baseURL: "https://proxy.example/v1", apiKey: "secret" })

    expect(resolved.route.endpoint.baseURL).toBe("https://proxy.example/v1")
  })
})
