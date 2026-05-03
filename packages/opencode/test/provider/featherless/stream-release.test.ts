import { describe, it, expect } from "bun:test"
import { wrapResponseWithRelease } from "../../../src/provider/sdk/featherless/stream-release"

const enc = new TextEncoder()

const makeBody = (chunks: Uint8Array[]) => {
  let i = 0
  return new ReadableStream<Uint8Array>({
    pull(ctrl) {
      if (i >= chunks.length) {
        ctrl.close()
        return
      }
      ctrl.enqueue(chunks[i++])
    },
  })
}

const drain = async (res: Response): Promise<string> => {
  const reader = res.body!.getReader()
  const dec = new TextDecoder()
  let out = ""
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    out += dec.decode(value, { stream: true })
  }
  return out
}

describe("wrapResponseWithRelease", () => {
  it("releases on natural stream completion", async () => {
    let released = 0
    const body = makeBody([enc.encode("hello"), enc.encode(" world")])
    const wrapped = wrapResponseWithRelease(new Response(body, { status: 200 }), () => released++)
    expect(await drain(wrapped)).toBe("hello world")
    expect(released).toBe(1)
  })

  it("releases on consumer cancel mid-stream", async () => {
    let released = 0
    const body = makeBody([enc.encode("a"), enc.encode("b"), enc.encode("c")])
    const wrapped = wrapResponseWithRelease(new Response(body, { status: 200 }), () => released++)
    const reader = wrapped.body!.getReader()
    const first = await reader.read()
    expect(new TextDecoder().decode(first.value!)).toBe("a")
    await reader.cancel("user abort")
    expect(released).toBe(1)
  })

  it("releases on underlying read error", async () => {
    let released = 0
    const erroring = new ReadableStream<Uint8Array>({
      pull(ctrl) {
        ctrl.error(new Error("upstream blew up"))
      },
    })
    const wrapped = wrapResponseWithRelease(new Response(erroring, { status: 200 }), () => released++)
    await expect(drain(wrapped)).rejects.toThrow(/upstream/)
    expect(released).toBe(1)
  })

  it("is idempotent: completion + late cancel doesn't double-release", async () => {
    let released = 0
    const body = makeBody([enc.encode("x")])
    const wrapped = wrapResponseWithRelease(new Response(body, { status: 200 }), () => released++)
    const reader = wrapped.body!.getReader()
    await reader.read() // x
    await reader.read() // done -> fire
    await reader.cancel("after-the-fact")
    expect(released).toBe(1)
  })

  it("releases immediately when response has no body", () => {
    let released = 0
    wrapResponseWithRelease(new Response(null, { status: 204 }), () => released++)
    expect(released).toBe(1)
  })

  it("preserves status, statusText, and headers", async () => {
    let released = 0
    const body = makeBody([enc.encode("ok")])
    const wrapped = wrapResponseWithRelease(
      new Response(body, {
        status: 201,
        statusText: "Created",
        headers: { "x-test": "yes", "content-type": "text/plain" },
      }),
      () => released++,
    )
    expect(wrapped.status).toBe(201)
    expect(wrapped.statusText).toBe("Created")
    expect(wrapped.headers.get("x-test")).toBe("yes")
    expect(wrapped.headers.get("content-type")).toBe("text/plain")
    await drain(wrapped)
    expect(released).toBe(1)
  })

  it("swallows release() throws so the stream stays clean", async () => {
    const body = makeBody([enc.encode("k")])
    const wrapped = wrapResponseWithRelease(new Response(body, { status: 200 }), () => {
      throw new Error("release boom")
    })
    // Should not throw out of drain.
    await drain(wrapped)
  })
})
