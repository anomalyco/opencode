import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { isolatedEnv } from "../fixture/environment"
import { tmpdir } from "../fixture/tmpdir"

type ChatRequest = { messages: Array<{ role: string; content: string }> }

test("passes a run message after a separator to the provider once", async () => {
  await using root = await tmpdir()
  const config = path.join(root.path, "config")
  const workspace = path.join(root.path, "workspace")
  const models = path.join(root.path, "models.json")
  await Promise.all([fs.mkdir(config, { recursive: true }), fs.mkdir(workspace)])

  const requests: ChatRequest[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (request.method !== "POST" || new URL(request.url).pathname !== "/v1/chat/completions") {
        return new Response("Not found", { status: 404 })
      }
      // SAFETY: the local mock only receives OpenAI-compatible chat requests created by this test's CLI.
      requests.push((await request.json()) as ChatRequest)
      return completion("ok")
    },
  })

  try {
    await Promise.all([
      Bun.write(
        path.join(config, "opencode.json"),
        JSON.stringify({
          providers: {
            mock: {
              package: "@opencode/ai/providers/openai-compatible",
              settings: { apiKey: "test-key", baseURL: `http://127.0.0.1:${server.port}/v1` },
              models: { mock: { name: "Mock" } },
            },
          },
        }),
      ),
      Bun.write(models, "{}"),
    ])

    const env = isolatedEnv(root.path, {
      PWD: workspace,
      USERPROFILE: root.path,
      OPENCODE_CONFIG: undefined,
      OPENCODE_CONFIG_CONTENT: undefined,
      OPENCODE_DISABLE_AUTOUPDATE: "true",
      OPENCODE_MODELS_PATH: models,
    })
    // One real CLI subprocess: only the separator case duplicated the message.
    const child = Bun.spawn(
      [
        process.execPath,
        "run",
        path.join(import.meta.dir, "../../src/index.ts"),
        "run",
        "--standalone",
        "--format",
        "json",
        "--model",
        "mock/mock",
        "--",
        "DUPREPRO",
      ],
      {
        cwd: path.join(import.meta.dir, "../.."),
        env,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      },
    )
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])

    expect(exitCode).toBe(0)
    expect(stderr).toBe("")
    expect(stdout).toContain('"type":"text"')
    const messages = requests.flatMap(userMessages)
    expect(messages).toContain("DUPREPRO")
    expect(messages.filter((message) => message === "DUPREPRO")).toHaveLength(1)
  } finally {
    await server.stop(true)
  }
}, 60_000)

function userMessages(body: ChatRequest) {
  return body.messages.flatMap((message) => (message.role === "user" ? [message.content] : []))
}

function completion(text: string) {
  const chunks = [
    { choices: [{ delta: { role: "assistant" }, finish_reason: null }], usage: null },
    { choices: [{ delta: { content: text }, finish_reason: null }], usage: null },
    { choices: [{ delta: {}, finish_reason: "stop" }], usage: null },
    { choices: [], usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 } },
  ]
  return new Response(`${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`, {
    headers: { "content-type": "text/event-stream" },
  })
}
