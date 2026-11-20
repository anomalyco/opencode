import { afterEach, describe, expect, jest, test } from "bun:test"
import {
  fileContentFromBytes,
  headStreamedFile,
  MAX_MEDIA_BYTES,
  MAX_PREVIEW_BYTES,
  readBoundedFile,
} from "./artifact"
import { approxBytes } from "./content-cache"

describe("fileContentFromBytes", () => {
  test("keeps media bytes with a mime type, including videos past 25 MiB", () => {
    const png = new Uint8Array([137, 80, 78, 71])
    expect(fileContentFromBytes("a.png", png)).toEqual({
      type: "binary",
      content: "",
      bytes: png,
      mimeType: "image/png",
    })

    const video = new Uint8Array(40 * 1024 * 1024)
    const content = fileContentFromBytes("arcade-update-draft.mp4", video)
    expect(content).toEqual({
      type: "binary",
      content: "",
      bytes: video,
      mimeType: "video/mp4",
    })
    expect(approxBytes(content)).toBe(video.byteLength)
  })

  test("decodes text and svg with a mime type and byte size", () => {
    expect(fileContentFromBytes("a.svg", new TextEncoder().encode("<svg/>"))).toEqual({
      type: "text",
      content: "<svg/>",
      mimeType: "image/svg+xml",
      size: 6,
    })
    expect(fileContentFromBytes("a.ts", new TextEncoder().encode("const a = 1"))).toEqual({
      type: "text",
      content: "const a = 1",
      mimeType: undefined,
      size: 11,
    })
  })

  test("drops incomplete trailing UTF-8 bytes when decoding a truncated slice", () => {
    // "a,b\n🎉" where 🎉 is F0 9F 8E 89; cut after the first two bytes of the emoji.
    const full = new TextEncoder().encode("a,b\n🎉")
    const cut = full.subarray(0, full.length - 2)

    expect(fileContentFromBytes("data.csv", cut, { size: 70_000_000, truncated: true })).toEqual({
      type: "text",
      content: "a,b\n",
      mimeType: "text/csv",
      size: 70_000_000,
      truncated: true,
    })
  })

  test("keeps only the size of media above the cap", () => {
    const content = fileContentFromBytes("big.mp4", new Uint8Array(MAX_MEDIA_BYTES + 1))
    expect(content).toEqual({ type: "binary", content: "", size: MAX_MEDIA_BYTES + 1 })
  })

  test("marks unknown binaries without keeping bytes", () => {
    expect(fileContentFromBytes("a.bin", new Uint8Array([1, 0, 2]))).toEqual({ type: "binary", content: "", size: 3 })
  })
})

describe("readBoundedFile", () => {
  test("falls back to full download when HEAD fits within the preview cap or fails", async () => {
    const methods: string[] = []

    const small = await readBoundedFile(
      async (_url, init) => {
        methods.push(init.method ?? "GET")

        return new Response(null, { status: 200, headers: { "content-length": String(MAX_PREVIEW_BYTES) } })
      },
      "small.csv",
      "http://server/small.csv",
      new AbortController().signal,
    )

    expect(small).toBeUndefined()
    expect(methods).toEqual(["HEAD"])

    const missing = await readBoundedFile(
      async () => new Response(null, { status: 404 }),
      "missing.csv",
      "http://server/missing.csv",
      new AbortController().signal,
    )

    expect(missing).toBeUndefined()
  })

  test("fetches only the leading byte range for oversized CSVs and preserves full size", async () => {
    const totalSize = 72_351_744
    const requests: Array<{ method: string; range: string | null; auth: string | null }> = []
    const prefix = new Uint8Array(MAX_PREVIEW_BYTES)
    const headerBytes = new TextEncoder().encode("id,name\n1,Alice\n")
    prefix.set(headerBytes)
    prefix.fill(0x61, headerBytes.length, MAX_PREVIEW_BYTES - 2)
    // Incomplete 4-byte UTF-8 sequence at the end of the range slice.
    prefix[MAX_PREVIEW_BYTES - 2] = 0xf0
    prefix[MAX_PREVIEW_BYTES - 1] = 0x9f

    const content = await readBoundedFile(
      async (_url, init) => {
        const headers = new Headers(init.headers)
        requests.push({
          method: init.method ?? "GET",
          range: headers.get("range"),
          auth: headers.get("authorization"),
        })

        if (init.method === "HEAD") {
          return new Response(null, { status: 200, headers: { "content-length": String(totalSize) } })
        }

        return new Response(prefix, {
          status: 206,
          headers: { "content-range": `bytes 0-${MAX_PREVIEW_BYTES - 1}/${totalSize}` },
        })
      },
      "huge.csv",
      "http://server/huge.csv",
      new AbortController().signal,
      { Authorization: "Basic dGVzdA==" },
    )

    expect(requests).toEqual([
      { method: "HEAD", range: null, auth: "Basic dGVzdA==" },
      { method: "GET", range: `bytes=0-${MAX_PREVIEW_BYTES - 1}`, auth: "Basic dGVzdA==" },
    ])
    expect(content?.type).toBe("text")
    expect(content?.mimeType).toBe("text/csv")
    expect(content?.size).toBe(totalSize)
    expect(content?.truncated).toBe(true)
    expect(content?.content.startsWith("id,name\n1,Alice\n")).toBe(true)
    expect(content?.content.includes("\uFFFD")).toBe(false)
  })

  test("handles CORS-hidden Content-Range and servers that ignore Range or shrink the file", async () => {
    const fullChunk = new Uint8Array(MAX_PREVIEW_BYTES).fill(0x61)

    // Content-Range hidden by CORS: a full-cap 206 stays truncated with HEAD's size.
    const hiddenRange = await readBoundedFile(
      async (_url, init) =>
        init.method === "HEAD"
          ? new Response(null, { status: 200, headers: { "content-length": String(MAX_PREVIEW_BYTES * 5) } })
          : new Response(fullChunk, { status: 206 }),
      "cors.csv",
      "http://server/cors.csv",
      new AbortController().signal,
    )

    expect(hiddenRange?.truncated).toBe(true)
    expect(hiddenRange?.size).toBe(MAX_PREVIEW_BYTES * 5)

    // File shrank between HEAD and GET with Content-Range hidden: fewer bytes than the cap means EOF was reached.
    const shrank = await readBoundedFile(
      async (_url, init) =>
        init.method === "HEAD"
          ? new Response(null, { status: 200, headers: { "content-length": String(MAX_PREVIEW_BYTES * 5) } })
          : new Response("a,b\n1,2\n", { status: 206 }),
      "shrank.csv",
      "http://server/shrank.csv",
      new AbortController().signal,
    )

    expect(shrank).toEqual({
      type: "text",
      content: "a,b\n1,2\n",
      mimeType: "text/csv",
      size: 8,
    })

    // Server ignored Range and replied 200 with the complete body.
    const ignoredRange = await readBoundedFile(
      async (_url, init) =>
        init.method === "HEAD"
          ? new Response(null, { status: 200, headers: { "content-length": String(MAX_PREVIEW_BYTES * 5) } })
          : new Response("a,b\n1,2\n", { status: 200 }),
      "full.csv",
      "http://server/full.csv",
      new AbortController().signal,
    )

    expect(ignoredRange).toEqual({
      type: "text",
      content: "a,b\n1,2\n",
      mimeType: "text/csv",
      size: 8,
    })

    // File shrank to empty -> 416 falls back to full download.
    const unsatisfiable = await readBoundedFile(
      async (_url, init) =>
        init.method === "HEAD"
          ? new Response(null, { status: 200, headers: { "content-length": String(MAX_PREVIEW_BYTES * 5) } })
          : new Response(null, { status: 416 }),
      "empty.csv",
      "http://server/empty.csv",
      new AbortController().signal,
    )

    expect(unsatisfiable).toBeUndefined()
  })
})

// The media HEAD skips the API's request queue, so it bounds its own wait for a response, and only that wait.
describe("headStreamedFile", () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  function server() {
    const calls: { signal: AbortSignal | null | undefined; answer: (response: Response) => void }[] = []

    const fetch = (_url: string, init: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason))
        calls.push({ signal: init.signal, answer: resolve })
      })

    return { calls, fetch }
  }

  test("gives up on a server that sends no response within a minute", async () => {
    jest.useFakeTimers()
    const head = server()
    const response = headStreamedFile(head.fetch, "http://server/a.mp4", new AbortController().signal)

    jest.advanceTimersByTime(59_999)
    expect(head.calls[0]?.signal?.aborted).toBe(false)

    jest.advanceTimersByTime(1)
    const error = await response.catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(DOMException)
    expect(error).toMatchObject({ name: "TimeoutError" })
  })

  test("drops the deadline once the server answers", async () => {
    jest.useFakeTimers()
    const head = server()
    const response = headStreamedFile(head.fetch, "http://server/a.mp4", new AbortController().signal)

    head.calls[0]?.answer(new Response(null, { headers: { "content-length": "9" } }))
    await expect(response).resolves.toBeInstanceOf(Response)

    jest.advanceTimersByTime(10 * 60_000)
    expect(head.calls[0]?.signal?.aborted).toBe(false)
  })

  test("passes the caller's abort on", async () => {
    const head = server()
    const controller = new AbortController()
    const response = headStreamedFile(head.fetch, "http://server/a.mp4", controller.signal)

    controller.abort()

    await expect(response).rejects.toMatchObject({ name: "AbortError" })
  })
})
