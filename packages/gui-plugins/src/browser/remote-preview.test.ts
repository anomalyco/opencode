import { afterAll, beforeAll, expect, test } from "bun:test"
import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { remotePreview } from "./remote-preview"
import { workspaceFileURL } from "./link"
import { previewAddress } from "./preview"
import { createHandlePath } from "./disk"
import { resolvePreviewRequest, type PreviewSource } from "./workspace-file"

// Main uses the host HTTP stack, not the DOM's CORS preflight implementation.
beforeAll(() => GlobalRegistrator.unregister())

afterAll(() => GlobalRegistrator.register())

test("a file's size is the server's answer to HEAD; a missing file or a redirect is no file", async () => {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      const name = new URL(req.url).pathname.split("/").at(-1)

      if (name === "index.html") return new Response(null, { headers: { "content-length": "42" } })

      if (name === "moved.html") return new Response(null, { status: 302, headers: { location: "/elsewhere" } })

      return new Response(null, { status: 404 })
    },
  })

  try {
    const signal = new AbortController().signal

    const preview = remotePreview(
      { id: "remote", sameMachine: false, headers: {}, url: server.url.href },
      "ses_a",
      { directory: "/work" },
      signal,
    )

    expect(await preview.stat("index.html", signal)).toBe(42)
    expect(await preview.stat("missing.html", signal)).toBeNull()
    expect(await preview.stat("moved.html", signal)).toBeNull()
  } finally {
    await server.stop(true)
  }
})

test("the authenticated read under a server base path names exactly the file validated by stat", async () => {
  const checked: string[] = []
  const reads: string[] = []
  const ranges: (string | null)[] = []
  const base = "/sub/api/fs/read/"

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      const url = new URL(req.url)
      expect(url.searchParams.get("location[directory]")).toBe("/work")
      expect(url.searchParams.get("location[workspace]")).toBe("wrk_1")
      expect(req.headers.get("authorization")).toBe("fixture")
      expect(req.headers.get("accept-encoding")).toBe("identity")
      expect(url.pathname.startsWith(base)).toBe(true)
      // As the server reads it: the rest of the path, decoded once.
      const path = decodeURIComponent(url.pathname.slice(base.length))

      if (req.method === "HEAD") checked.push(path)
      else {
        reads.push(path)
        ranges.push(req.headers.get("range"))
      }

      return new Response(req.method === "HEAD" ? null : "x", { headers: { "content-length": "1" } })
    },
  })

  const controller = new AbortController()

  const source = remotePreview(
    { id: "test", url: `${server.url}sub`, sameMachine: false, headers: { authorization: "fixture" } },
    "ses_x",
    { directory: "/work", workspace: "wrk_1" },
    controller.signal,
  )

  const grants = new Map<string, PreviewSource>([
    ["grant", { ...source, document: "index.html", takeEntry: () => false, denied: () => {} }],
  ])

  const names = ["dir/50% off.html", "#?.txt", "a%2fb", "%252e%252e/[slug]", "???.txt"]

  try {
    for (const path of names) {
      const url = previewAddress(workspaceFileURL("/work", path, "ses_x"), "grant", [], source.prefix)

      const file =
        url && (await resolvePreviewRequest(`${url}?ignored=yes`, "GET", undefined, grants, controller.signal, createHandlePath()))

      if (!file || file.type !== "remote") throw new Error("expected remote file")
      expect(await (await file.read(file.path, undefined, controller.signal)).text()).toBe("x")
    }

    expect(checked).toEqual(names)
    expect(reads).toEqual(names)
    await (await source.read("index.html", "bytes=0-0", controller.signal)).body?.cancel()
    expect(ranges.at(-1)).toBe("bytes=0-0")
  } finally {
    controller.abort()
    await server.stop(true)
  }
})
