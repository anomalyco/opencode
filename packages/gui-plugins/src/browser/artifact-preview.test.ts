import { afterAll, beforeAll, expect, test } from "bun:test"
import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { artifactPages } from "./artifact-preview"
import { FileVerificationError } from "@opencode/util/file-verification"

beforeAll(() => GlobalRegistrator.unregister())

afterAll(() => GlobalRegistrator.register())

test("preflight asks this server for the entry before allocating a tab or granting bytes", async () => {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      expect(request.method).toBe("HEAD")
      expect(url.searchParams.get("location[directory]")).toBe("/project")

      if (url.pathname === "/api/experimental/artifacts/art_unverified/view/")
        return new Response(null, { status: 503, headers: { "x-opencode-file-error": "file_verification_unavailable" } })

      return new Response(null, { status: url.pathname === "/api/experimental/artifacts/art_here/view/" ? 200 : 404 })
    },
  })

  try {
    const artifacts = artifactPages(
      {
        failure: () => undefined,
        grant: () => {
          throw new Error("unexpected grant")
        },
        dispose() {},
      },
      { id: "server", url: server.url.href, headers: {}, sameMachine: false },
      "/project",
      new AbortController().signal,
    )

    expect(await artifacts.exists("artifact://art_here/")).toBe(true)
    expect(await artifacts.exists("artifact://art_elsewhere/")).toBe(false)
    await expect(artifacts.exists("artifact://art_unverified/")).rejects.toBeInstanceOf(FileVerificationError)
  } finally {
    await server.stop(true)
  }
})
