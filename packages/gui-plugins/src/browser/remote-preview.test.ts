import { afterAll, beforeAll, expect, test } from "bun:test"
import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { remotePreview } from "./remote-preview"
import { FileVerificationError } from "@opencode/util/file-verification"
import { workspaceFileURL } from "./link"
import { previewAddress } from "./preview"
import { resolvePreviewRequest, type PreviewSource } from "./workspace-file"

// Main uses the host HTTP stack, not the DOM's CORS preflight implementation.
beforeAll(() => GlobalRegistrator.unregister())

afterAll(() => GlobalRegistrator.register())

test("an unmarked router 404 requires an update, not a missing-file message", async () => {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(null, { status: 404 }) })

  try {
    const signal = new AbortController().signal

    const preview = remotePreview(
      { id: "old", sameMachine: false, headers: {}, url: server.url.href },
      "ses_a",
      { directory: "/work" },
      signal,
    )

    expect(await preview.stat("index.html", signal)).toBeNull()
    expect(preview.needsUpdate?.()).toBe(true)
  } finally {
    await server.stop(true)
  }
})

test("the authenticated read under a server base path names exactly the file validated by stat", async () => {
  const checked: string[] = []
  const reads: string[] = []

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      const url = new URL(req.url)
      expect(url.searchParams.get("location[directory]")).toBe("/work")
      expect(req.headers.get("authorization")).toBe("fixture")
      expect(req.headers.get("accept-encoding")).toBe("identity")
      expect(url.pathname).toBe("/sub/api/experimental/preview/read")
      const pin = "a".repeat(64)

      if (url.searchParams.get("root") === "bind") return new Response(null, {headers:{"x-opencode-preview":"3","x-opencode-preview-root":pin}})
      expect(url.searchParams.get("root")).toBe(pin)

      if (url.searchParams.get("path") === "unverified.html")
        return new Response(null, { status: 503, headers: { "x-opencode-preview": "3", "x-opencode-file-error": "file_verification_unavailable" } })

      if (req.method === "HEAD") checked.push(url.searchParams.get("path") ?? "")
      else reads.push(url.searchParams.get("path") ?? "")

      return new Response("x", { headers: { "x-opencode-preview": "3", "content-length": "1" } })
    },
  })

  const controller = new AbortController()

  const source = remotePreview(
    { id: "test", url: `${server.url}sub`, sameMachine: false, headers: { authorization: "fixture" } },
    "ses_x",
    { directory: "/work" },
    controller.signal,
  )

  const identity = await source.pin("index.html", controller.signal)

  const restricted = remotePreview({id:"test",url:`${server.url}sub`,sameMachine:false,headers:{authorization:"fixture"}}, "ses_x", {directory:"/work"}, controller.signal, {})
  expect(await restricted.pin("index.html", controller.signal)).toBeUndefined()
  expect(restricted.needsUpdate?.()).toBe(true)

  if (!identity) throw new Error("expected root identity")
  const grants = new Map<string, PreviewSource>([["grant", {...source, identity, document:"index.html", takeEntry:()=>false, denied:()=>{}}]])
  const names = ["dir/50% off.html", "#?.txt", "a%2fb", "%252e%252e/[slug]", "日本語.txt"]

  try {
    for (const path of names) {
      const url = previewAddress(workspaceFileURL("/work", path, "ses_x"), "grant", [], source.prefix)

      const file =
        url && (await resolvePreviewRequest(`${url}?ignored=yes`, "GET", undefined, grants, controller.signal))

      if (!file || file.type !== "remote") throw new Error("expected remote file")
      expect(await (await file.read(file.path, undefined, controller.signal)).text()).toBe("x")
    }

    expect(checked).toEqual(names)
    expect(reads).toEqual(names)
    await expect(source.stat("unverified.html", controller.signal)).rejects.toBeInstanceOf(FileVerificationError)
  } finally {
    controller.abort()
    await server.stop(true)
  }
})
