import { describe, expect, test } from "bun:test"
import { gateways, gatewayProviderConfig, type CustomGateway } from "./gateways-catalog"

describe("gateways catalog", () => {
  test("has unique gateway ids", () => {
    const ids = gateways.map((gateway) => gateway.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test("custom gateways declare an https base URL and at least one model", () => {
    const custom = gateways.filter((gateway): gateway is CustomGateway => gateway.kind === "custom")
    expect(custom.length).toBeGreaterThan(0)
    for (const gateway of custom) {
      expect(gateway.baseURL.startsWith("https://")).toBe(true)
      expect(Object.keys(gateway.models).length).toBeGreaterThan(0)
    }
  })

  test("gatewayProviderConfig builds an OpenAI-compatible provider config", () => {
    const gateway = gateways.find((item): item is CustomGateway => item.id === "kilo")
    if (!gateway) throw new Error("expected kilo gateway in catalog")
    expect(gatewayProviderConfig(gateway)).toEqual({
      npm: "@ai-sdk/openai-compatible",
      name: "Kilo Gateway",
      options: {
        baseURL: "https://api.kilo.ai/api/openrouter",
      },
      models: {
        "kilo-auto/free": { name: "Kilo Auto (Free)" },
      },
    })
  })
})
