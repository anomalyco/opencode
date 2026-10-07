import { expect, test } from "bun:test"
import { createServer } from "node:http"
import { listOllama, mutateOllama } from "@opencode-ai/app/ollama/transport"
import type { OllamaMutation } from "@opencode-ai/app/ollama/types"

test("inventory hides migration manifests and lists each public tag once while preserving user aliases", async () => {
  const digest = "c97eb11d70b1acdc88af01eef566c1fe4f7fbe93eb1afc06871132f293ff425a"
  const server = createServer((_request, response) => {
    response.setHeader("Content-Type", "application/json")
    response.end(
      JSON.stringify({
        models: [
          { name: `llamacpp:${digest}`, digest },
          { name: "qwen3.5:9b", digest: "original", details: { family: "qwen35", runner: "ggml" } },
          { name: "qwen3.5:9b", digest, details: { family: "qwen35", runner: "llamacpp" } },
          { name: "qwen-copy:latest", digest },
          { name: "qwen-copy", digest },
          { name: "llamacpp:custom", digest },
        ],
      }),
    )
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("address")
  try {
    const result = await listOllama({ baseURL: `http://127.0.0.1:${address.port}` }, AbortSignal.timeout(5000))
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.value.map((model) => model.name)).toEqual(["qwen3.5:9b", "qwen-copy:latest", "llamacpp:custom"])
    expect(result.value[0].digest).toBe("original")
  } finally {
    server.closeAllConnections()
    server.close()
  }
})

test("context updates keep the same tag while copy/create still protect existing destinations", async () => {
  const requests: { from: string; model: string; parameters: { num_ctx: number } }[] = []
  const server = createServer(async (request, response) => {
    response.setHeader("Content-Type", "application/json")
    if (request.url === "/api/tags") {
      response.end(JSON.stringify({ models: [{ name: "speech:latest" }, { name: "other:latest" }] }))
      return
    }
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    if (request.url !== "/api/create") {
      response.writeHead(400)
      response.end()
      return
    }
    requests.push(JSON.parse(Buffer.concat(chunks).toString()))
    response.end('{"status":"success"}\n')
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("address")
  const mutate = (mutation: OllamaMutation) =>
    mutateOllama({
      connection: { baseURL: `http://127.0.0.1:${address.port}` },
      mutation,
      id: "context-test",
      signal: AbortSignal.timeout(5000),
      progress: () => {},
    })
  try {
    for (const context of [16384, 32768]) {
      expect(await mutate({ action: "context", model: "speech:latest", context })).toEqual({
        ok: true,
        value: undefined,
      })
    }
    expect(requests.map((request) => [request.from, request.model, request.parameters.num_ctx])).toEqual([
      ["speech:latest", "speech:latest", 16384],
      ["speech:latest", "speech:latest", 32768],
    ])
    expect(await mutate({ action: "context", model: "missing", context: 8192 })).toEqual({
      ok: false,
      error: "configuration",
    })
    expect(await mutate({ action: "context", model: "speech", context: 1 })).toEqual({ ok: false, error: "context" })
    expect(await mutate({ action: "create", source: "speech", model: "other", context: 8192 })).toEqual({
      ok: false,
      error: "exists",
    })
    expect(await mutate({ action: "copy", source: "speech", model: "other" })).toEqual({ ok: false, error: "exists" })
    expect(requests).toHaveLength(2)
  } finally {
    server.closeAllConnections()
    server.close()
  }
})
