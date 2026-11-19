import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

test("serves a session and runs both shopping tools through OpenCode", async () => {
  const articleUrl = "https://www.wildberries.ru/catalog/123456/detail.aspx"
  const toolNames = ["wb_compare_unit_prices", "wb_product_link"]
  const calls = [
    { name: "wb_product_link", args: { article: "123456" } },
    {
      name: "wb_compare_unit_prices",
      args: {
        unit: "piece",
        offers: [
          { name: "A", priceRub: 300, quantity: 2 },
          { name: "B", priceRub: 400, quantity: 4 },
        ],
      },
    },
  ]

  const state = await mkdtemp(join(tmpdir(), "opencode-wb-"))
  const password = "wb-smoke-test"
  const model = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      expect(new URL(request.url).pathname).toBe("/v1/chat/completions")
      const body = await request.json()
      const outputs = body.messages.filter((message: { role: string }) => message.role === "tool")
      const turn = outputs.length

      if (turn === 0) {
        expect(body.tools.map((tool: { function: { name: string } }) => tool.function.name).sort()).toEqual(toolNames)
      }
      if (turn >= 1) {
        expect(JSON.parse(outputs[0].content).artifacts).toEqual([articleUrl])
      }
      if (turn === 2) {
        expect(JSON.parse(outputs[1].content).offers[0]).toMatchObject({ name: "B", rubPerUnit: 100 })
      }

      const call = calls[turn]
      const delta = call
        ? {
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: `call_${turn}`,
                type: "function",
                function: { name: call.name, arguments: JSON.stringify(call.args) },
              },
            ],
          }
        : { role: "assistant", content: `B: 100 RUB per piece. ${articleUrl}` }
      const chunks = [
        { delta, finish_reason: null },
        { delta: {}, finish_reason: call ? "tool_calls" : "stop" },
      ].map((choice) =>
        JSON.stringify({
          id: `completion_${turn}`,
          object: "chat.completion.chunk",
          created: 1,
          model: "shopping-test",
          choices: [{ index: 0, ...choice }],
        }),
      )

      return new Response(`${chunks.map((chunk) => `data: ${chunk}\n\n`).join("")}data: [DONE]\n\n`, {
        headers: { "content-type": "text/event-stream" },
      })
    },
    error(error) {
      return new Response(String(error), { status: 400 })
    },
  })

  const child = Bun.spawn(["./opencode-wb", "serve"], {
    cwd: import.meta.dir,
    stdout: "pipe",
    stderr: "inherit",
    env: {
      PATH: process.env.PATH,
      OPENCODE_TEST_HOME: state,
      XDG_CONFIG_HOME: join(state, "config"),
      XDG_DATA_HOME: join(state, "data"),
      XDG_STATE_HOME: join(state, "state"),
      XDG_CACHE_HOME: join(state, "cache"),
      OPENCODE_SERVER_PASSWORD: password,
      OPENCODE_DISABLE_MODELS_FETCH: "1",
      WB_HARNESS_PORT: "0",
      OPENCODE_CONFIG_CONTENT: JSON.stringify({
        enabled_providers: ["wb-test"],
        model: "wb-test/shopping-test",
        provider: {
          "wb-test": {
            npm: "@ai-sdk/openai-compatible",
            options: { baseURL: new URL("/v1", model.url).href, apiKey: "test" },
            models: { "shopping-test": { name: "Shopping smoke test", tool_call: true } },
          },
        },
      }),
    },
  })

  try {
    const signal = AbortSignal.timeout(35_000)
    let startup = ""
    let serverUrl: string | undefined
    const stdout = child.stdout.pipeThrough(new TextDecoderStream(), { signal }).getReader()
    while (!serverUrl) {
      const { done, value } = await stdout.read()
      if (done) break
      startup += value
      serverUrl = startup.match(/listening on (http:\/\/127\.0\.0\.1:\d+)\s/)?.[1]
    }
    await stdout.cancel()
    expect(serverUrl).toBeDefined()
    expect((await fetch(`${serverUrl}/session`, { signal })).status).toBe(401)

    const headers = {
      authorization: `Basic ${btoa(`opencode:${password}`)}`,
      "content-type": "application/json",
    }
    const created = await fetch(`${serverUrl}/session`, { method: "POST", headers, body: "{}", signal })
    expect(created.status).toBe(200)
    const session = await created.json()
    const response = await fetch(`${serverUrl}/session/${session.id}/message`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        agent: "wb-shopping",
        parts: [{ type: "text", text: "Дай ссылку на артикул 123456 и сравни 2 шт. за 300 ₽ и 4 шт. за 400 ₽." }],
      }),
      signal,
    })
    expect(response.status).toBe(200)
    const message = await response.json()
    expect(message.info.error).toBeUndefined()
    expect(message.parts).toContainEqual(
      expect.objectContaining({ type: "text", text: expect.stringContaining(articleUrl) }),
    )

    const history = await fetch(`${serverUrl}/session/${session.id}/message`, { headers, signal })
    expect(history.status).toBe(200)
    const turns = (await history.json()) as { parts: { type: string; tool?: string; state?: { status: string } }[] }[]
    const completedTools = turns
      .flatMap((turn) => turn.parts)
      .filter((part) => part.type === "tool" && part.state?.status === "completed")
      .map((part) => part.tool)
      .sort()
    expect(completedTools).toEqual(toolNames)
  } finally {
    child.kill()
    await child.exited
    model.stop(true)
    await rm(state, { recursive: true, force: true })
  }
}, 45_000)
