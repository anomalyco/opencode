import { describe, expect, test } from "bun:test"
import { corsHeaders } from "../src/routes/zen/util/cors"
import { buildModelsResponse, buildOptionsResponse } from "../src/routes/zen/util/modelsHandler"

describe("corsHeaders", () => {
  test("allows all origins", () => {
    expect(corsHeaders["Access-Control-Allow-Origin"]).toBe("*")
  })

  test("allows GET, POST, and OPTIONS", () => {
    expect(corsHeaders["Access-Control-Allow-Methods"]).toBe("GET, POST, OPTIONS")
  })

  test("allows content-type and authorization headers", () => {
    expect(corsHeaders["Access-Control-Allow-Headers"]).toBe("Content-Type, Authorization")
  })
})

describe("buildOptionsResponse", () => {
  test("returns 200 with CORS headers", async () => {
    const response = await buildOptionsResponse()
    expect(response.status).toBe(200)
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*")
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET, POST, OPTIONS")
    expect(response.headers.get("Access-Control-Allow-Headers")).toBe("Content-Type, Authorization")
  })
})

describe("buildModelsResponse", () => {
  test("returns models with CORS headers", async () => {
    const response = await buildModelsResponse(["model-1", "model-2"])
    expect(response.status).toBe(200)
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*")
    expect(response.headers.get("Content-Type")).toBe("application/json")

    const body = await response.json()
    expect(body.data.map((model: { id: string }) => model.id)).toEqual(["model-1", "model-2"])
  })
})
