import { afterEach, describe, expect, test } from "bun:test"
import { discoverOpenAICompatibleModels, DiscoverError } from "./discover"

const servers: ReturnType<typeof Bun.serve>[] = []

afterEach(() => {
  while (servers.length) servers.pop()?.stop(true)
})

function serve(handler: (request: Request) => Response | Promise<Response>) {
  const server = Bun.serve({ fetch: handler, port: 0 })
  servers.push(server)
  return server.url.origin
}

describe("discoverOpenAICompatibleModels", () => {
  test("fetches /v1/models with bearer auth and returns trimmed, deduped ids", async () => {
    let path = ""
    let auth: string | null = "unset"
    const origin = serve((request) => {
      path = new URL(request.url).pathname
      auth = request.headers.get("authorization")
      return Response.json({ data: [{ id: "model-a" }, { id: "model-b" }, { id: " model-a " }, { id: "  " }] })
    })

    const ids = await discoverOpenAICompatibleModels({ baseURL: `${origin}/v1`, apiKey: "secret" })

    expect(ids).toEqual(["model-a", "model-b"])
    expect(path).toBe("/v1/models")
    expect(auth).toBe("Bearer secret")
  })

  test("preserves an existing /api/v1 path instead of replacing it", async () => {
    let path = ""
    const origin = serve((request) => {
      path = new URL(request.url).pathname
      return Response.json({ data: [{ id: "model-a" }] })
    })

    await discoverOpenAICompatibleModels({ baseURL: `${origin}/api/v1` })
    expect(path).toBe("/api/v1/models")
  })

  test("omits the bearer header without an api key", async () => {
    let auth: string | null = "unset"
    const origin = serve((request) => {
      auth = request.headers.get("authorization")
      return Response.json({ data: [{ id: "model-a" }] })
    })

    await discoverOpenAICompatibleModels({ baseURL: origin })
    expect(auth).toBeNull()
  })

  test("resolves {env:...} api keys from process.env", async () => {
    const name = "OPENCODE_TEST_DISCOVER_KEY"
    process.env[name] = "env-secret"
    try {
      let auth: string | null = "unset"
      const origin = serve((request) => {
        auth = request.headers.get("authorization")
        return Response.json({ data: [{ id: "model-a" }] })
      })

      await discoverOpenAICompatibleModels({ baseURL: origin, apiKey: `{env:${name}}` })
      expect(auth).toBe("Bearer env-secret")
    } finally {
      delete process.env[name]
    }
  })

  test("throws invalidUrl for a non-http base URL", async () => {
    await expect(discoverOpenAICompatibleModels({ baseURL: "api.example.com" })).rejects.toMatchObject({
      kind: "invalidUrl",
    })
  })

  test("throws unauthorized for 401", async () => {
    const origin = serve(() => new Response("nope", { status: 401 }))
    await expect(discoverOpenAICompatibleModels({ baseURL: origin, apiKey: "wrong" })).rejects.toMatchObject({
      kind: "unauthorized",
    })
  })

  test("throws invalidFormat for a non-model-list payload", async () => {
    const origin = serve(() => Response.json({ data: "models" }))
    await expect(discoverOpenAICompatibleModels({ baseURL: origin })).rejects.toMatchObject({
      kind: "invalidFormat",
    })
  })

  test("throws timeout when the server never responds", async () => {
    const origin = serve(() => new Promise<Response>(() => {}))
    await expect(discoverOpenAICompatibleModels({ baseURL: origin, timeoutMs: 30 })).rejects.toMatchObject({
      kind: "timeout",
    })
  })

  test("exposes a DiscoverError class", () => {
    expect(new DiscoverError({ kind: "failed" })).toBeInstanceOf(DiscoverError)
  })
})
