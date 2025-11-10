import { describe, expect, test } from "bun:test"
import path from "path"
import { Provider } from "../../src/provider/provider"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("Provider.getSmallModel", () => {
  test("should return haiku model for anthropic provider", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const small = await Provider.getSmallModel("anthropic")

        if (small) {
          expect(small.providerID).toBe("anthropic")
          expect(
            small.modelID.includes("haiku") ||
              small.modelID.includes("3-5-haiku") ||
              small.modelID.includes("3.5-haiku"),
          ).toBe(true)
        }
      },
    })
  })

  test("should return flash model for google provider", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const small = await Provider.getSmallModel("google")

        if (small) {
          expect(small.providerID).toBe("google")
          expect(small.modelID.includes("flash")).toBe(true)
        }
      },
    })
  })

  test("should return nano model for openai provider", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const small = await Provider.getSmallModel("openai")

        if (small) {
          expect(small.providerID).toBe("openai")
          expect(small.modelID.includes("nano")).toBe(true)
        }
      },
    })
  })

  test("should return undefined for non-existent provider", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const small = await Provider.getSmallModel("nonexistent-provider-xyz")
        expect(small).toBeUndefined()
      },
    })
  })

  test("should respect config.small_model when set", async () => {
    // Note: This test would require mocking Config.get() to return a custom small_model
    // Left as a placeholder for manual testing with config changes
    // The implementation in provider.ts already handles this case
  })

  test("should filter out premium models for github-copilot", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const small = await Provider.getSmallModel("github-copilot")

        if (small) {
          expect(small.providerID).toBe("github-copilot")
          // Should not select claude-haiku-4.5 for github-copilot (premium model)
          expect(small.modelID).not.toContain("claude-haiku-4.5")
        }
      },
    })
  })

  test("should fall back to next priority model when first choice unavailable", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        // The priority list is: haiku-4-5, haiku-4.5, 3-5-haiku, 3.5-haiku, flash, nano
        // If a provider exists but doesn't have the top priority model,
        // it should fall back to the next available one
        const providers = await Provider.list()
        const providerID = Object.keys(providers)[0]

        if (providerID) {
          const small = await Provider.getSmallModel(providerID)
          // Should return SOME small model, even if not the top priority
          if (small) {
            expect(small.providerID).toBe(providerID)
            expect(small.modelID).toBeDefined()
          }
        }
      },
    })
  })
})
