import { afterAll, beforeAll, expect, test } from "bun:test"
import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { remotePreview } from "./remote-preview"
import { workspaceFileURL } from "./link"
import { previewAddress } from "./preview"
import { resolvePreviewRequest, type PreviewSource } from "./workspace-file"

// Main uses the host HTTP stack, not the DOM's CORS preflight implementation.
beforeAll(() => GlobalRegistrator.unregister())

afterAll(() => GlobalRegistrator.register())

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
      expect(url.pathname.startsWith("/sub/api/fs/read/")).toBe(true)
      reads.push(decodeURIComponent(url.pathname.slice("/sub/api/fs/read/".length)))

      return new Response("x")
    },
  })

  const controller = new AbortController()

  const source = remotePreview(
    { id: "test", url: `${server.url}sub`, sameMachine: false, headers: { authorization: "fixture" } },
    "ses_x",
    { directory: "/work" },
    controller.signal,
    async (path) => {
      checked.push(path)

      return 1
    },
  )

  const grants = new Map<string, PreviewSource>([["grant", source]])
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
  } finally {
    controller.abort()
    await server.stop(true)
  }
})
