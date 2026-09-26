import { describe, expect, test } from "bun:test"
import { Snowflake } from "../../src/provider/snowflake"

function streamFrom(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
}

async function rewrite(chunks: string[]) {
  const encoder = new TextEncoder()
  const stream = Snowflake.rewriteSnowflakeRole(streamFrom(chunks.map((chunk) => encoder.encode(chunk))))
  return await new Response(stream).text()
}

describe("provider.snowflake role rewrite", () => {
  test("rewrites an empty role inside a single chunk", async () => {
    const out = await rewrite(['data: {"choices":[{"delta":{"role":"","content":"hi"}}]}\n\n'])
    expect(out).toContain('"role":"assistant"')
    expect(out).not.toContain('"role":""')
  })

  test("rewrites an empty role split across chunks", async () => {
    expect(await rewrite(['{"role"', ":", '""}'])).toBe('{"role":"assistant"}')
  })

  test("rewrites a role separated by a gap larger than the old 512-byte hold", async () => {
    const gap = " ".repeat(2_000)
    const out = await rewrite(['{"role":', gap.slice(0, 1_000), gap.slice(1_000), '""}'])
    expect(out).not.toContain('"role":""')
    expect(out).toContain('"role":"assistant"')
  })

  test("does not rewrite a non-empty role", async () => {
    expect(await rewrite(['{"role":"user"}'])).toBe('{"role":"user"}')
  })
})
