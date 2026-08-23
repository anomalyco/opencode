import { describe, expect, test } from "bun:test"
import { buildCostChunk, parseChunkIdentity } from "../src/routes/zen/util/provider/provider"

describe("parseChunkIdentity", () => {
  test("extracts id, model and created from a chat chunk frame", () => {
    const part = 'data: {"id":"gen-1","object":"chat.completion.chunk","created":1755000000,"model":"gpt-5.6-luna","choices":[]}'
    expect(parseChunkIdentity(part)).toEqual({
      id: "gen-1",
      model: "gpt-5.6-luna",
      created: 1755000000,
    })
  })

  test("ignores [DONE] and non-data lines", () => {
    expect(parseChunkIdentity("data: [DONE]")).toBeUndefined()
    expect(parseChunkIdentity("event: ping\ndata: {\"type\":\"ping\"}")).toBeUndefined()
    expect(parseChunkIdentity("")).toBeUndefined()
  })
})

describe("buildCostChunk", () => {
  test("oa-compat cost chunk echoes stream identity", () => {
    const chunk = buildCostChunk("oa-compat", "0.0001", {
      id: "gen-1",
      model: "gpt-5.6-luna",
      created: 1755000000,
    })
    const payload = JSON.parse(chunk.replace(/^data: /, "").trim())
    expect(payload).toEqual({
      id: "gen-1",
      object: "chat.completion.chunk",
      created: 1755000000,
      model: "gpt-5.6-luna",
      choices: [],
      cost: "0.0001",
    })
  })

  test("oa-compat cost chunk keeps identity keys present when unknown", () => {
    const payload = JSON.parse(buildCostChunk("oa-compat", "0").replace(/^data: /, "").trim())
    expect(payload).toEqual({
      id: "",
      object: "chat.completion.chunk",
      created: 0,
      model: "",
      choices: [],
      cost: "0",
    })
  })

  test("anthropic and openai formats keep the ping event shape", () => {
    for (const format of ["anthropic", "openai"] as const) {
      const chunk = buildCostChunk(format, "0.5", { id: "gen-1" })
      expect(chunk).toContain("event: ping")
      expect(JSON.parse(chunk.split("data: ")[1].trim())).toEqual({ type: "ping", cost: "0.5" })
    }
  })
})
