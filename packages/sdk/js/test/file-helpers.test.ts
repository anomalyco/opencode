import { describe, expect, test } from "bun:test"
import { uploadFiles, deleteFile, mkdirFile, renameFile } from "../src/v2/file"

/**
 * Unit tests for SDK file helpers.
 *
 * These verify that the helper functions construct the correct HTTP requests
 * (method, URL, headers, body) and handle responses/errors properly.
 *
 * The actual server endpoints are e2e tested in packages/opencode/test/file/write.test.ts.
 */

/** Create a mock fetch that captures the request and returns a canned response */
function mockFetch(response: { status: number; body: unknown }) {
  const calls: { url: string; method: string; headers: Record<string, string>; body: any }[] = []

  const fn = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    const method = init?.method ?? "GET"
    const headers: Record<string, string> = {}
    if (init?.headers) {
      const h = init.headers
      if (h instanceof Headers) {
        h.forEach((v, k) => (headers[k] = v))
      } else if (Array.isArray(h)) {
        for (const [k, v] of h) headers[k] = v
      } else {
        Object.assign(headers, h)
      }
    }

    calls.push({ url, method, headers, body: init?.body })

    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    })
  }

  return { fn: fn as typeof globalThis.fetch, calls }
}

// ---------------------------------------------------------------------------
// uploadFiles
// ---------------------------------------------------------------------------
describe("uploadFiles", () => {
  test("sends POST to /file/upload with FormData", async () => {
    const mock = mockFetch({ status: 200, body: [{ path: "hello.txt", size: 11 }] })

    const results = await uploadFiles({
      baseUrl: "http://localhost:4096",
      files: { "hello.txt": new File(["hello world"], "hello.txt") },
      fetch: mock.fn,
    })

    expect(mock.calls).toHaveLength(1)
    expect(mock.calls[0].url).toBe("http://localhost:4096/file/upload")
    expect(mock.calls[0].method).toBe("POST")
    expect(mock.calls[0].body).toBeInstanceOf(FormData)
    expect(results).toEqual([{ path: "hello.txt", size: 11 }])
  })

  test("includes path field in FormData when targetDir is set", async () => {
    const mock = mockFetch({ status: 200, body: [{ path: "uploads/a.txt", size: 3 }] })

    await uploadFiles({
      baseUrl: "http://localhost:4096",
      files: { file: new File(["aaa"], "a.txt") },
      targetDir: "uploads",
      fetch: mock.fn,
    })

    const formData = mock.calls[0].body as FormData
    expect(formData.get("path")).toBe("uploads")
  })

  test("converts string values to Blob in FormData", async () => {
    const mock = mockFetch({ status: 200, body: [{ path: "readme.md", size: 7 }] })

    await uploadFiles({
      baseUrl: "http://localhost:4096",
      files: { "readme.md": "# Hello" },
      fetch: mock.fn,
    })

    const formData = mock.calls[0].body as FormData
    const entry = formData.get("readme.md")
    expect(entry).toBeInstanceOf(File)
  })

  test("passes extra headers", async () => {
    const mock = mockFetch({ status: 200, body: [{ path: "x.txt", size: 1 }] })

    await uploadFiles({
      baseUrl: "http://localhost:4096",
      files: { "x.txt": new File(["x"], "x.txt") },
      headers: { "X-Custom": "test" },
      fetch: mock.fn,
    })

    expect(mock.calls[0].headers["X-Custom"]).toBe("test")
  })

  test("throws on non-OK response", async () => {
    const mock = mockFetch({ status: 400, body: { error: "bad request" } })

    await expect(
      uploadFiles({
        baseUrl: "http://localhost:4096",
        files: { "x.txt": new File(["x"], "x.txt") },
        fetch: mock.fn,
      }),
    ).rejects.toThrow("Upload failed (400)")
  })

  test("throws on 500 response", async () => {
    const mock = mockFetch({ status: 500, body: { error: "internal" } })

    await expect(
      uploadFiles({
        baseUrl: "http://localhost:4096",
        files: { "x.txt": new File(["x"], "x.txt") },
        fetch: mock.fn,
      }),
    ).rejects.toThrow("Upload failed (500)")
  })
})

// ---------------------------------------------------------------------------
// deleteFile
// ---------------------------------------------------------------------------
describe("deleteFile", () => {
  test("sends DELETE to /file with JSON body", async () => {
    const mock = mockFetch({ status: 200, body: true })

    const result = await deleteFile({
      baseUrl: "http://localhost:4096",
      path: "old-file.ts",
      fetch: mock.fn,
    })

    expect(mock.calls).toHaveLength(1)
    expect(mock.calls[0].url).toBe("http://localhost:4096/file")
    expect(mock.calls[0].method).toBe("DELETE")
    expect(mock.calls[0].headers["Content-Type"]).toBe("application/json")
    expect(JSON.parse(mock.calls[0].body)).toEqual({ path: "old-file.ts" })
    expect(result).toBe(true)
  })

  test("passes extra headers", async () => {
    const mock = mockFetch({ status: 200, body: true })

    await deleteFile({
      baseUrl: "http://localhost:4096",
      path: "x.txt",
      headers: { "X-Custom": "val" },
      fetch: mock.fn,
    })

    expect(mock.calls[0].headers["X-Custom"]).toBe("val")
    expect(mock.calls[0].headers["Content-Type"]).toBe("application/json")
  })

  test("throws on non-OK response", async () => {
    const mock = mockFetch({ status: 404, body: { error: "not found" } })

    await expect(
      deleteFile({ baseUrl: "http://localhost:4096", path: "nope.txt", fetch: mock.fn }),
    ).rejects.toThrow("Delete failed (404)")
  })
})

// ---------------------------------------------------------------------------
// mkdirFile
// ---------------------------------------------------------------------------
describe("mkdirFile", () => {
  test("sends POST to /file/mkdir with JSON body", async () => {
    const mock = mockFetch({ status: 200, body: true })

    const result = await mkdirFile({
      baseUrl: "http://localhost:4096",
      path: "src/new-dir",
      fetch: mock.fn,
    })

    expect(mock.calls).toHaveLength(1)
    expect(mock.calls[0].url).toBe("http://localhost:4096/file/mkdir")
    expect(mock.calls[0].method).toBe("POST")
    expect(mock.calls[0].headers["Content-Type"]).toBe("application/json")
    expect(JSON.parse(mock.calls[0].body)).toEqual({ path: "src/new-dir" })
    expect(result).toBe(true)
  })

  test("throws on non-OK response", async () => {
    const mock = mockFetch({ status: 400, body: { error: "bad" } })

    await expect(
      mkdirFile({ baseUrl: "http://localhost:4096", path: "../../evil", fetch: mock.fn }),
    ).rejects.toThrow("Mkdir failed (400)")
  })
})

// ---------------------------------------------------------------------------
// renameFile
// ---------------------------------------------------------------------------
describe("renameFile", () => {
  test("sends POST to /file/rename with JSON body", async () => {
    const mock = mockFetch({ status: 200, body: true })

    const result = await renameFile({
      baseUrl: "http://localhost:4096",
      from: "old.ts",
      to: "new.ts",
      fetch: mock.fn,
    })

    expect(mock.calls).toHaveLength(1)
    expect(mock.calls[0].url).toBe("http://localhost:4096/file/rename")
    expect(mock.calls[0].method).toBe("POST")
    expect(mock.calls[0].headers["Content-Type"]).toBe("application/json")
    expect(JSON.parse(mock.calls[0].body)).toEqual({ from: "old.ts", to: "new.ts" })
    expect(result).toBe(true)
  })

  test("throws on non-OK response", async () => {
    const mock = mockFetch({ status: 404, body: { error: "not found" } })

    await expect(
      renameFile({ baseUrl: "http://localhost:4096", from: "a", to: "b", fetch: mock.fn }),
    ).rejects.toThrow("Rename failed (404)")
  })
})
