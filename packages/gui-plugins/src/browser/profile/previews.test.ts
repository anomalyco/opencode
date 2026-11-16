import { expect, test } from "bun:test"
import type { PreviewSource } from "../workspace-file"
import { servePreview } from "./serve"

type Remote = Extract<PreviewSource, { type: "remote" }>

test("artifact responses install Chromium's connection allowlist even for scripts", async () => {
  const grants = new Map<string, PreviewSource>([
    [
      "site",
      {
        type: "artifact",
        id: "art_doc",
        read: async () => new Response("example", { headers: { "content-type": "text/javascript" } }),
      },
    ],
  ])

  const response = await servePreview(new Request("oc-preview://site/asset.js"), grants)
  expect(response.headers.get("connection-allowlist")).toBe("(response-origin);webrtc=block")
  expect(response.headers.get("x-dns-prefetch-control")).toBe("off")
  expect(await response.text()).toBe("example")
})

function fixture(read: Remote["read"]) {
  const grants = new Map<string, PreviewSource>([
    [
      "test",
      {
        type: "remote",
        root: "/work",
        document: "index.html",
        identity: "fixture",
        pin: async () => "fixture",
        takeEntry: () => false,
        denied: () => {},
        prefix: "workspace://session/",
        stat: async () => 10,
        read,
      },
    ],
  ])

  return {
    grants,
    serve: (method: string, range?: string) =>
      servePreview(
        new Request("oc-preview://test/notes.txt", { method, headers: range ? { range } : undefined }),
        grants,
      ),
  }
}

test("workspace responses forbid sniffing; size probes never start a byte read", async () => {
  const { serve } = fixture(async () => {
    throw new Error("unexpected byte read")
  })

  for (const [method, range, status, length] of [
    ["HEAD", undefined, 200, "10"],
    ["HEAD", "bytes=1-3", 206, "3"],
    ["GET", "bytes=10-", 416, "0"],
  ] as const) {
    const response = await serve(method, range)
    expect(response.status).toBe(status)
    expect(response.headers.get("content-length")).toBe(length)
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(await response.text()).toBe("")
  }
})

test.each([
  [200, "4", null],
  [302, "4", null],
  [401, "4", null],
  [206, null, "bytes 0-3/10"],
  [206, "3", "bytes 0-3/10"],
  [206, "4", "bytes 0-3/20"],
  [206, "4", "revoked"],
] as const)("cancels the upstream body on refusal: %s %s %s", async (status, length, range) => {
  let cancelled = false

  const { serve, grants } = fixture(async () => {
    const headers = new Headers()

    if (length) headers.set("content-length", length)

    if (range) headers.set("content-range", range === "revoked" ? "bytes 0-3/10" : range)

    if (range === "revoked") grants.clear()

    return new Response(
      new ReadableStream({
        cancel() {
          cancelled = true
        },
      }),
      { status, headers },
    )
  })

  const response = await serve("GET", "bytes=0-3")
  expect(response.type).toBe("error")
  expect(cancelled).toBe(true)
})
