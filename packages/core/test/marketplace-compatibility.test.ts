import { describe, expect, test } from "bun:test"
import { evaluateMarketplaceCompatibility } from "../src/marketplace-compatibility"

describe("marketplace compatibility", () => {
  test("accepts matching host requirements", () => {
    expect(
      evaluateMarketplaceCompatibility(
        {
          opencode: ">=1.18.0",
          platforms: ["linux"],
          architectures: ["x64"],
          runtimes: ["bun"],
          capabilities: ["mcp"],
        },
        {
          opencode: "1.18.10",
          platform: "linux",
          architecture: "x64",
          runtimes: ["bun"],
          capabilities: ["mcp"],
        },
      ),
    ).toEqual({ compatible: true, reasons: [] })
  })

  test("reports every incompatible host requirement", () => {
    const result = evaluateMarketplaceCompatibility(
      {
        opencode: ">=2",
        platforms: ["darwin"],
        architectures: ["arm64"],
        runtimes: ["node"],
        capabilities: ["hooks"],
      },
      {
        opencode: "1.18.10",
        platform: "linux",
        architecture: "x64",
        runtimes: ["bun"],
        capabilities: ["mcp"],
      },
    )
    expect(result.compatible).toBe(false)
    expect(result.reasons).toHaveLength(5)
  })
})
