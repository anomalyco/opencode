import { describe, expect, it } from "bun:test"
import { getProviderApiKeyUrl } from "./urls"

describe("getProviderApiKeyUrl", () => {
  it("returns the dashboard URL for a known provider", () => {
    expect(getProviderApiKeyUrl("openai")).toBe("https://platform.openai.com/api-keys")
  })

  it("returns undefined for an unknown or unconfigured provider", () => {
    expect(getProviderApiKeyUrl("non-existent-provider")).toBeUndefined()
  })
})