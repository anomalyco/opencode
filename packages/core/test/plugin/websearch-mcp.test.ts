import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { WebSearchMcp } from "@opencode/core/plugin/websearch/mcp"

const result = Schema.Struct({
  content: Schema.Array(Schema.Struct({ type: Schema.Literal("text"), text: Schema.String })),
})
const response = { result: result.make({ content: [{ type: "text", text: "search result" }] }) }

describe("WebSearchMcp.parseResponse", () => {
  test("accepts a JSON response", async () => {
    expect(await Effect.runPromise(WebSearchMcp.parseResponse(JSON.stringify(response), result))).toEqual(
      response.result,
    )
  })

  test.each(["\n", "\r\n", "\r"])("accepts SSE with optional data spacing and %j line endings", async (newline) => {
    for (const space of ["", " "]) {
      const body = `event: message${newline}data:${space}${JSON.stringify(response)}${newline}${newline}`
      expect(await Effect.runPromise(WebSearchMcp.parseResponse(body, result))).toEqual(response.result)
    }
  })

  test("joins multiple data fields before decoding JSON", async () => {
    const body = `: keepalive\nretry: 1000\n\nevent: message\ndata:{"result":\ndata: ${JSON.stringify(response.result)}}\n\n`
    expect(await Effect.runPromise(WebSearchMcp.parseResponse(body, result))).toEqual(response.result)
  })

  test("does not combine data from separate events", async () => {
    const body = `data: ignored\n\ndata:${JSON.stringify(response)}\n\n`
    expect(await Effect.runPromise(WebSearchMcp.parseResponse(body, result))).toEqual(response.result)
  })

  test("returns no result for a comment-only stream", async () => {
    expect(await Effect.runPromise(WebSearchMcp.parseResponse(": keepalive\n\n", result))).toBeUndefined()
  })
})
