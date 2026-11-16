import { describe, expect, test } from "bun:test"
import { unloadLocalModel, unloadRequest } from "../../src/plugin/provider/local-unload"

describe("unloadRequest", () => {
  test("a cloud chat does not unload", () => {
    expect(
      unloadRequest({
        providerID: "openai",
        modelID: "gpt-5",
        baseURL: "https://api.openai.com/v1",
      }),
    ).toBeUndefined()
  })

  test("a local server with no unload address does not guess", () => {
    expect(
      unloadRequest({
        providerID: "local",
        modelID: "local-model",
        baseURL: "http://127.0.0.1:8081/v1",
      }),
    ).toBeUndefined()
  })

  test("ollama unloads the chat model with keep_alive 0", () => {
    expect(
      unloadRequest({
        providerID: "ollama",
        modelID: "gemma3:4b",
        baseURL: "http://127.0.0.1:11434/v1",
        apiKey: "secret",
      }),
    ).toEqual({
      url: "http://127.0.0.1:11434/api/generate",
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer secret" },
      body: JSON.stringify({ model: "gemma3:4b", keep_alive: 0 }),
    })
  })

  test("an ollama server on another machine still unloads", () => {
    expect(
      unloadRequest({
        providerID: "ollama",
        modelID: "gemma3:4b",
        baseURL: "http://192.168.1.20:11434/v1",
      })?.url,
    ).toBe("http://192.168.1.20:11434/api/generate")
  })

  test("lm studio unloads the chat model", () => {
    expect(
      unloadRequest({
        providerID: "lmstudio",
        modelID: "google/gemma-4-26b",
        baseURL: "http://127.0.0.1:1234/v1",
      }),
    ).toMatchObject({
      url: "http://127.0.0.1:1234/api/v1/models/unload",
      body: JSON.stringify({ instance_id: "google/gemma-4-26b" }),
    })
  })

  test("another server on Ollama's port is left alone", () => {
    expect(
      unloadRequest({
        providerID: "local",
        modelID: "qwen",
        baseURL: "http://localhost:11434/v1",
      }),
    ).toBeUndefined()
  })

  test("a custom unload URL on this machine is posted as given", () => {
    expect(
      unloadRequest({
        providerID: "local",
        modelID: "local-model",
        baseURL: "http://127.0.0.1:8081/v1",
        unload: "http://127.0.0.1:8081/proxy/stop",
      }),
    ).toMatchObject({
      url: "http://127.0.0.1:8081/proxy/stop",
      method: "POST",
    })
  })

  test("a custom unload URL on another website is ignored", () => {
    expect(
      unloadRequest({
        providerID: "local",
        modelID: "local-model",
        baseURL: "http://127.0.0.1:8081/v1",
        unload: "https://example.com/stop",
      }),
    ).toBeUndefined()
  })
})

describe("unloadLocalModel", () => {
  test("does not call the network for a cloud model", async () => {
    let called = false
    const unloaded = await unloadLocalModel(
      { providerID: "anthropic", modelID: "claude", baseURL: "https://api.anthropic.com" },
      async () => {
        called = true
        return new Response()
      },
    )
    expect(unloaded).toBe(false)
    expect(called).toBe(false)
  })

  test("posts the ollama unload", async () => {
    const bodies: unknown[] = []
    const server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        bodies.push({ path: new URL(request.url).pathname, body: await request.json() })
        return Response.json({ done: true })
      },
    })
    const unloaded = await unloadLocalModel({
      providerID: "ollama",
      modelID: "gemma3:4b",
      baseURL: `${server.url.origin}/v1`,
    })
    server.stop(true)
    expect(unloaded).toBe(true)
    expect(bodies).toEqual([{ path: "/api/generate", body: { model: "gemma3:4b", keep_alive: 0 } }])
  })

  test("a server that does not answer does not throw", async () => {
    const unloaded = await unloadLocalModel(
      { providerID: "ollama", modelID: "gemma3:4b", baseURL: "http://127.0.0.1:11434/v1" },
      () => Promise.reject(new Error("down")),
    )
    expect(unloaded).toBe(false)
  })
})
