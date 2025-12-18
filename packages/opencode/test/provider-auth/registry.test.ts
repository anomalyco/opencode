import { describe, expect, test } from "bun:test"
import { ProviderAuthRegistry } from "../../src/provider-auth/registry"

describe("ProviderAuthRegistry", () => {
  test("resolves alias provider ids to the correct adapter", () => {
    const adapter = ProviderAuthRegistry.getAdapter("github-copilot-enterprise")
    expect(adapter?.providerId).toBe("github-copilot")
  })

  test("lists alias provider ids", () => {
    const ids = ProviderAuthRegistry.listProviderIds()
    expect(ids).toContain("github-copilot-enterprise")
  })
})

