import { describe, expect, test } from "bun:test"
import { Provider } from "@/provider/provider"

describe("Provider.defaultModelIDs", () => {
  test("returns the first model id for every provider with models", () => {
    const providers = {
      alpha: { models: { sonnet: { id: "alpha-sonnet" }, haiku: { id: "alpha-haiku" } } },
      beta: { models: { pro: { id: "beta-pro" } } },
    } as unknown as Parameters<typeof Provider.defaultModelIDs>[0]

    const result = Provider.defaultModelIDs(providers)

    expect(result.alpha).toBe("alpha-sonnet")
    expect(result.beta).toBe("beta-pro")
    expect(Object.keys(result)).toEqual(["alpha", "beta"])
  })

  test("omits providers with no models instead of throwing", () => {
    const providers = {
      "bare-gateway": { models: {} },
      anthropic: { models: { "claude-sonnet-4-6": { id: "anthropic-sonnet" } } },
    } as unknown as Parameters<typeof Provider.defaultModelIDs>[0]

    let result: ReturnType<typeof Provider.defaultModelIDs> | undefined
    expect(() => {
      result = Provider.defaultModelIDs(providers)
    }).not.toThrow()

    expect(result).toBeDefined()
    expect(result!["bare-gateway"]).toBeUndefined()
    expect(result!.anthropic).toBe("anthropic-sonnet")
    expect(Object.keys(result!)).toEqual(["anthropic"])
  })

  test("returns an empty object when every provider has no models", () => {
    const providers = {
      a: { models: {} },
      b: { models: {} },
    } as unknown as Parameters<typeof Provider.defaultModelIDs>[0]

    expect(() => Provider.defaultModelIDs(providers)).not.toThrow()
    expect(Provider.defaultModelIDs(providers)).toEqual({})
  })
})
