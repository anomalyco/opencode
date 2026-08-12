import { describe, expect, test } from "bun:test"
import { buildModelsResponse, buildOptionsResponse } from "../src/routes/zen/util/modelsHandler"

describe("Zen CORS responses", () => {
  test("includes CORS headers on actual model list responses", async () => {
    const response = await buildModelsResponse(["model-a"])

    expect(response.headers.get("access-control-allow-origin")).toBe("*")
    expect(response.headers.get("access-control-allow-methods")).toContain("GET")
    expect(response.headers.get("access-control-allow-methods")).toContain("POST")
    expect(response.headers.get("access-control-allow-headers")).toContain("Authorization")
  })

  test("keeps CORS headers on preflight responses", async () => {
    const response = await buildOptionsResponse()

    expect(response.headers.get("access-control-allow-origin")).toBe("*")
  })
})
