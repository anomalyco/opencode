import { describe, expect, test } from "bun:test"
import { prepareRequestBody } from "../src/routes/zen/util/requestBody"

describe("Zen request body streaming", () => {
  test("patches the leading model without buffering the remaining body", async () => {
    let reads = 0
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          const chunks = [
            '{"model":"client-model","stream":true,"messages":[',
            JSON.stringify({ role: "user", content: "large payload" }),
            "]}",
          ]
          const chunk = chunks[reads++]
          if (chunk) controller.enqueue(new TextEncoder().encode(chunk))
          else controller.close()
        },
      },
      { highWaterMark: 0 },
    )

    const request = await prepareRequestBody(body)
    expect(request.model).toBe("client-model")
    expect(reads).toBe(1)

    const output = await new Response(request.stream("provider-model", false)).text()
    expect(JSON.parse(output)).toEqual({
      model: "provider-model",
      stream: true,
      messages: [{ role: "user", content: "large payload" }],
    })
  })

  test("appends stream usage options at the end of the request", async () => {
    const body = new Blob(['{"model":"client-model","stream":true,"messages":[]}   ']).stream()
    const request = await prepareRequestBody(body)
    const output = await new Response(request.stream("provider-model", true)).text()

    expect(JSON.parse(output)).toEqual({
      model: "provider-model",
      stream: true,
      messages: [],
      stream_options: { include_usage: true },
    })
    expect(output.endsWith("   ")).toBe(true)
  })

  test("detects streaming after a large message while forwarding", async () => {
    const content = "x".repeat(128 * 1024)
    let reads = 0
    const chunks = [
      '{"model":"client-model","messages":[',
      JSON.stringify({ role: "user", content }),
      '],"stream":true}',
    ]
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          const chunk = chunks[reads++]
          if (chunk) controller.enqueue(new TextEncoder().encode(chunk))
          else controller.close()
        },
      },
      { highWaterMark: 0 },
    )
    const request = await prepareRequestBody(body)
    expect(reads).toBe(1)
    const output = await new Response(request.stream("provider-model", true)).text()

    expect(JSON.parse(output)).toEqual({
      model: "provider-model",
      messages: [{ role: "user", content }],
      stream: true,
      stream_options: { include_usage: true },
    })
  })

  test("buffers through a late model field and then streams the rest", async () => {
    const content = "こんにちは".repeat(32 * 1024)
    let reads = 0
    const chunks = [
      '{"messages":[',
      JSON.stringify({ role: "user", content }),
      '],"model":"client-model","stream":true,"extra":"after-model"}',
    ]
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          const chunk = chunks[reads++]
          if (chunk) controller.enqueue(new TextEncoder().encode(chunk))
          else controller.close()
        },
      },
      { highWaterMark: 0 },
    )
    const request = await prepareRequestBody(body)

    expect(request.model).toBe("client-model")
    expect(reads).toBe(3)
    expect(JSON.parse(await new Response(request.stream("provider-model", true)).text())).toEqual({
      messages: [{ role: "user", content }],
      model: "provider-model",
      stream: true,
      extra: "after-model",
      stream_options: { include_usage: true },
    })
  })

  test("preserves a UTF-8 BOM while patching the model", async () => {
    const body = new Blob(['\uFEFF{"messages":[],"model":"client-model","stream":false}']).stream()
    const request = await prepareRequestBody(body)
    const output = new Uint8Array(await new Response(request.stream("provider-model", false)).arrayBuffer())

    expect([...output.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(JSON.parse(new TextDecoder().decode(output))).toEqual({
      messages: [],
      model: "provider-model",
      stream: false,
    })
  })
})
