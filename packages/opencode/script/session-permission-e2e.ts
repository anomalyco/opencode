// Script to verify session permission updates allow external paths through the local serve/run flow.
import { mkdir, mkdtemp } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createOpencodeClient } from "@opencode-ai/sdk/v2"

function chunk(input: { delta?: Record<string, unknown>; finish?: string }) {
  return {
    id: "chatcmpl-test",
    object: "chat.completion.chunk",
    choices: [
      {
        delta: input.delta ?? {},
        ...(input.finish ? { finish_reason: input.finish } : {}),
      },
    ],
  }
}

function line(input: unknown) {
  return `data: ${JSON.stringify(input)}\n\n`
}

function sse(...input: unknown[]) {
  return new Response(input.map(line).join("") + "data: [DONE]\n\n", {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  })
}

function title(body: unknown) {
  return JSON.stringify(body).includes("Generate a title for this conversation")
}

function toolResult(body: unknown) {
  if (!body || typeof body !== "object") return false
  if ("messages" in body && Array.isArray(body.messages)) {
    return body.messages.at(-1)?.role === "tool"
  }
  if ("input" in body && Array.isArray(body.input)) {
    return body.input.some((item) => item?.type === "function_call_output")
  }
  return false
}

async function wait(url: string, headers: Record<string, string>) {
  const end = Date.now() + 30_000
  while (Date.now() < end) {
    const res = await fetch(new URL("/health", url), { headers }).catch(() => undefined)
    if (res?.ok) return
    await Bun.sleep(100)
  }
  throw new Error(`Timed out waiting for ${url}`)
}

const root = path.resolve(import.meta.dir, "..")
const tmp = await mkdtemp(path.join(os.tmpdir(), "opencode-session-permission-"))
const dir = path.join(tmp, "project")
const out = path.join(tmp, "outside")
const xdg = path.join(tmp, "xdg")
const home = path.join(tmp, "home")
const file = path.join(out, "secret.txt")
const pass = "test-pass"

await mkdir(dir, { recursive: true })
await mkdir(out, { recursive: true })
await mkdir(xdg, { recursive: true })
await mkdir(home, { recursive: true })
await Bun.write(file, "secret data")

const llm = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url)
    if (req.method !== "POST" || url.pathname !== "/v1/chat/completions") {
      return new Response("not found", { status: 404 })
    }

    const body = await req.json().catch(() => ({}))
    if (title(body)) {
      return sse(chunk({ delta: { role: "assistant" } }), chunk({ delta: { content: "E2E Title" } }), chunk({ finish: "stop" }))
    }
    if (toolResult(body)) {
      return sse(chunk({ delta: { role: "assistant" } }), chunk({ delta: { content: "done" } }), chunk({ finish: "stop" }))
    }

    return sse(
      chunk({ delta: { role: "assistant" } }),
      chunk({
        delta: {
          tool_calls: [
            {
              index: 0,
              id: "call_1",
              type: "function",
              function: {
                name: "read",
                arguments: "",
              },
            },
          ],
        },
      }),
      chunk({
        delta: {
          tool_calls: [
            {
              index: 0,
              function: {
                arguments: JSON.stringify({ filePath: file }),
              },
            },
          ],
        },
      }),
      chunk({ finish: "tool_calls" }),
    )
  },
})

const cfg = {
  $schema: "https://opencode.ai/config.json",
  model: "test/test-model",
  provider: {
    test: {
      name: "Test",
      id: "test",
      env: [],
      npm: "@ai-sdk/openai-compatible",
      models: {
        "test-model": {
          id: "test-model",
          name: "Test Model",
          attachment: false,
          reasoning: false,
          temperature: false,
          tool_call: true,
          release_date: "2025-01-01",
          limit: { context: 100000, output: 10000 },
          cost: { input: 0, output: 0 },
          options: {},
        },
      },
      options: {
        apiKey: "test-key",
        baseURL: new URL("/v1", llm.url).toString(),
      },
    },
  },
}

await Bun.write(path.join(dir, "opencode.json"), JSON.stringify(cfg, null, 2))

const probe = Bun.serve({ port: 0, fetch() { return new Response("ok") } })
const port = probe.port
probe.stop(true)

const env = {
  ...process.env,
  HOME: home,
  XDG_DATA_HOME: path.join(xdg, "share"),
  XDG_CACHE_HOME: path.join(xdg, "cache"),
  XDG_CONFIG_HOME: path.join(xdg, "config"),
  XDG_STATE_HOME: path.join(xdg, "state"),
  OPENCODE_MODELS_PATH: path.join(root, "test", "tool", "fixtures", "models-api.json"),
  OPENCODE_DISABLE_DEFAULT_PLUGINS: "true",
  OPENCODE_SERVER_PASSWORD: pass,
}

const auth = `Basic ${Buffer.from(`opencode:${pass}`).toString("base64")}`
const headers = { Authorization: auth }
const baseUrl = `http://127.0.0.1:${port}`

const server = Bun.spawn(["bun", "run", "--conditions=browser", "./src/index.ts", "serve", "--hostname", "127.0.0.1", "--port", String(port)], {
  cwd: root,
  env,
  stdout: "pipe",
  stderr: "pipe",
})

try {
  await wait(baseUrl, headers)

  const sdk = createOpencodeClient({ baseUrl, headers, directory: dir })
  const created = await sdk.session.create({ directory: dir, title: "session permission e2e" })
  const sessionID = created.data?.id
  if (!sessionID) throw new Error(`Failed to create session: ${JSON.stringify(created.error)}`)

  const permission = [
    { permission: "external_directory", action: "allow" as const, pattern: path.join(out, "*") },
    { permission: "read", action: "allow" as const, pattern: file },
  ]
  const updated = await sdk.session.update({ sessionID, directory: dir, permission })
  if (updated.error) throw new Error(`Failed to update session: ${JSON.stringify(updated.error)}`)

  const session = await sdk.session.get({ sessionID, directory: dir })
  const rules = session.data?.permission ?? []
  if (!rules.some((rule) => rule.permission === "external_directory" && rule.pattern === path.join(out, "*"))) {
    throw new Error(`Session is missing external_directory permission: ${JSON.stringify(rules)}`)
  }
  if (!rules.some((rule) => rule.permission === "read" && rule.pattern === file)) {
    throw new Error(`Session is missing read permission: ${JSON.stringify(rules)}`)
  }

  const run = Bun.spawn(
    [
      "bun",
      "run",
      "--conditions=browser",
      "./src/index.ts",
      "run",
      "--attach",
      baseUrl,
      "--session",
      sessionID,
      "--dir",
      dir,
      "--agent",
      "build",
      "--model",
      "test/test-model",
      "--format",
      "json",
      `Read ${file} and return its contents.`,
    ],
    {
      cwd: root,
      env,
      stdout: "pipe",
      stderr: "pipe",
    },
  )

  const stdout = await new Response(run.stdout).text()
  const stderr = await new Response(run.stderr).text()
  const code = await run.exited
  if (code !== 0) {
    throw new Error([`opencode run exited with ${code}`, stdout, stderr].filter(Boolean).join("\n\n"))
  }
  if (stdout.includes("permission requested")) {
    throw new Error(`run still requested permission:\n\n${stdout}`)
  }

  const tool = stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .find((event) => event.type === "tool_use" && event.part?.tool === "read")

  if (!tool) throw new Error(`Missing read tool event:\n\n${stdout}`)
  if (tool.part.state.status !== "completed") throw new Error(`Read tool did not complete:\n\n${JSON.stringify(tool, null, 2)}`)
  if (!String(tool.part.state.output).includes("secret data")) {
    throw new Error(`Read tool output did not include file contents:\n\n${JSON.stringify(tool, null, 2)}`)
  }

  console.log(`Verified session permission update for ${sessionID}`)
} finally {
  server.kill()
  await server.exited.catch(() => undefined)
  llm.stop(true)
}
