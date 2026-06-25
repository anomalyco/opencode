import { describe, expect, test } from "bun:test"
import { createOpencodeClient } from "@opencode-ai/sdk/v2"

function captureClient(baseUrl: string) {
  const requests: Request[] = []
  const sdk = createOpencodeClient({
    baseUrl,
    directory: "/tmp/client-project",
    fetch: (async (request: Request) => {
      requests.push(request)
      return Response.json({
        location: { directory: "/tmp/client-project", workspaceID: null, project: { id: "test", directory: "/" } },
        data: [],
      })
    }) as unknown as typeof fetch,
  })
  return { sdk, requests }
}

describe("createOpencodeClient base URL", () => {
  test("scheme-less base URL still routes the configured directory to /api endpoints", async () => {
    const { sdk, requests } = captureClient("localhost:4096")
    await sdk.v2.fs.find({ query: "file" })

    expect(requests).toHaveLength(1)
    const url = new URL(requests[0].url)
    expect(url.protocol).toBe("http:")
    expect(url.host).toBe("localhost:4096")
    expect(url.pathname).toBe("/api/fs/find")
    expect(url.searchParams.get("location[directory]")).toBe("/tmp/client-project")
  })

  test("explicit http scheme is preserved", async () => {
    const { sdk, requests } = captureClient("http://localhost:4096")
    await sdk.v2.fs.find({ query: "file" })

    const url = new URL(requests[0].url)
    expect(url.protocol).toBe("http:")
    expect(url.host).toBe("localhost:4096")
    expect(url.searchParams.get("location[directory]")).toBe("/tmp/client-project")
  })

  test("explicit https scheme is preserved", async () => {
    const { sdk, requests } = captureClient("https://opencode.example.com")
    await sdk.v2.fs.find({ query: "file" })

    const url = new URL(requests[0].url)
    expect(url.protocol).toBe("https:")
    expect(url.host).toBe("opencode.example.com")
    expect(url.searchParams.get("location[directory]")).toBe("/tmp/client-project")
  })
})
