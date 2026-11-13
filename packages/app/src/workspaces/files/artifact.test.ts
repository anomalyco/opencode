import { afterEach, describe, expect, jest, test } from "bun:test"
import { fileContentFromBytes, headStreamedFile, MAX_MEDIA_BYTES } from "./artifact"
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

  test("decodes text and svg with a mime type", () => {
    expect(fileContentFromBytes("a.svg", new TextEncoder().encode("<svg/>"))).toEqual({
      type: "text",
      content: "<svg/>",
      mimeType: "image/svg+xml",
    })
    expect(fileContentFromBytes("a.ts", new TextEncoder().encode("const a = 1"))).toEqual({
      type: "text",
      content: "const a = 1",
      mimeType: undefined,
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
