import { describe, expect, test } from "bun:test"
import { aiGatewayRestHeaders } from "@/provider/provider"

describe("aiGatewayRestHeaders", () => {
  test("maps every gateway control option to its cf-aig-* request header", () => {
    const headers = aiGatewayRestHeaders("my-gateway", "opencode/test", {
      metadata: { team: "core", cost_center: 7 },
      cacheTtl: 300,
      cacheKey: "prompt-v1",
      skipCache: true,
      collectLog: false,
    })

    expect(headers).toEqual({
      "cf-aig-gateway-id": "my-gateway",
      "User-Agent": "opencode/test",
      "cf-aig-metadata": JSON.stringify({ team: "core", cost_center: 7 }),
      "cf-aig-cache-ttl": "300",
      "cf-aig-cache-key": "prompt-v1",
      "cf-aig-skip-cache": "true",
      "cf-aig-collect-log": "false",
    })
  })

  test("omits headers for options that are not set", () => {
    const headers = aiGatewayRestHeaders("my-gateway", "opencode/test", {})

    expect(headers).toEqual({
      "cf-aig-gateway-id": "my-gateway",
      "User-Agent": "opencode/test",
    })
  })

  test("keeps explicitly false boolean controls on the wire while omitting unset ones", () => {
    const headers = aiGatewayRestHeaders("g", "ua", { skipCache: false })

    // skipCache: false is meaningful to the gateway (explicitly re-enable caching),
    // so it must serialize rather than disappear.
    expect(headers["cf-aig-skip-cache"]).toBe("false")
    expect(headers).not.toHaveProperty("cf-aig-cache-key")
    expect(headers).not.toHaveProperty("cf-aig-metadata")
  })
})
