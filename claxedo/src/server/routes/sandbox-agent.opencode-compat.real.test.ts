import { afterAll, afterEach, describe, expect, it } from "bun:test"
import { createServer as createHttpServer } from "node:http"
import { createServer as createNetServer, createConnection } from "node:net"
import { fileURLToPath } from "node:url"
import {
  brotliDecompressSync,
  gunzipSync,
  inflateSync,
  zstdDecompressSync,
} from "node:zlib"

type CoreAgent = "opencode" | "claude" | "codex" | "amp"
type OptionalAgent = "cursor" | "pi"

type ApiResponse = {
  status: number
  body: unknown
  text: string
  error: string | null
}

type AgentEntry = {
  id: string
  installed: boolean
  credentialsAvailable: boolean
}

type ProviderPayload = {
  all: Array<{ id: string; models?: Record<string, unknown> }>
  default: Record<string, string>
}

type Hit = {
  method: string
  url: string
  body: string
}

type Sandbox = {
  rootUrl: string
  opencodeUrl: string
  token: string | null
}
type SandboxClient = {
  dispose: () => Promise<void>
}

type RequestedAgent = CoreAgent | OptionalAgent

const coreAgents: CoreAgent[] = ["opencode", "claude", "codex", "amp"]
const requestedAgents: RequestedAgent[] = [
  "opencode",
  "claude",
  "codex",
  "amp",
  "cursor",
  "pi",
]

const model = {
  claude: { providerID: "claude", modelID: "default" },
  codex: { providerID: "codex", modelID: "gpt-5.2-codex" },
  amp: { providerID: "amp", modelID: "amp-default" },
}
const sandboxAgentModulePath = fileURLToPath(
  new URL("../../../node_modules/sandbox-agent/dist/index.js", import.meta.url),
)
let sandboxClient: SandboxClient | null = null

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer()
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address()
      if (!addr || typeof addr === "string") {
        server.close()
        reject(new Error("failed to resolve free port"))
        return
      }
      server.close(() => resolve(addr.port))
    })
  })
}

async function api(
  baseUrl: string,
  token: string | null,
  path: string,
  init: RequestInit = {},
  timeoutMs = 15_000,
): Promise<ApiResponse> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  const headers = new Headers(init.headers)
  headers.set("content-type", "application/json")
  if (token) headers.set("authorization", `Bearer ${token}`)

  try {
    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers,
      signal: ctrl.signal,
    })
    const text = await res.text()
    if (text.length === 0) return { status: res.status, body: null, text, error: null }
    try {
      return { status: res.status, body: JSON.parse(text), text, error: null }
    } catch {
      return { status: res.status, body: null, text, error: null }
    }
  } catch (error) {
    return { status: 0, body: null, text: "", error: String(error) }
  } finally {
    clearTimeout(timer)
  }
}

async function withSandbox(
  agent: string,
  env: Record<string, string>,
  run: (ctx: Sandbox) => Promise<void>,
) {
  const port = await freePort()
  process.env.SANDBOX_AGENT_PORT = String(port)
  process.env.SANDBOX_AGENT_TOKEN = `tok-${agent}-${Date.now()}`
  process.env.SANDBOX_AGENT_MODULE_PATH = sandboxAgentModulePath

  try {
    const { SandboxAgent } = await import(sandboxAgentModulePath)
    sandboxClient = await SandboxAgent.start({
      spawn: {
        enabled: true,
        host: "127.0.0.1",
        port,
        token: process.env.SANDBOX_AGENT_TOKEN,
        log: "inherit",
        env,
      },
    })
    const url = `http://127.0.0.1:${port}`
    console.log(`[sandbox-agent] Started ${agent} agent at ${url}`)
    console.log(`[sandbox-agent] Inspector: ${url}/ui/`)
    await run({
      rootUrl: url,
      opencodeUrl: `${url}/opencode`,
      token: process.env.SANDBOX_AGENT_TOKEN || null,
    })
  } finally {
    if (sandboxClient) {
      await sandboxClient.dispose().catch(() => {})
      sandboxClient = null
    }
  }
}

function sessionId(value: unknown): string {
  const record = asRecord(value)
  if (!record) return ""
  const id = record.id
  return typeof id === "string" ? id : ""
}

function assistantText(value: unknown): string {
  if (!Array.isArray(value)) return ""
  for (const item of value) {
    const message = asRecord(item)
    if (!message) continue
    const info = asRecord(message.info)
    if (!info || info.role !== "assistant") continue
    if (!Array.isArray(message.parts)) continue
    for (const part of message.parts) {
      const block = asRecord(part)
      if (!block || block.type !== "text") continue
      if (typeof block.text === "string" && block.text.length > 0) return block.text
    }
  }
  return ""
}

async function createSession(ctx: Sandbox, title: string) {
  const created = await api(ctx.opencodeUrl, ctx.token, "/session", {
    method: "POST",
    body: JSON.stringify({ title }),
  })
  expect(created.status).toBe(200)
  const id = sessionId(created.body)
  expect(id.length).toBeGreaterThan(0)
  return id
}

async function sendMessage(
  ctx: Sandbox,
  id: string,
  providerID: string,
  modelID: string,
  text: string,
  timeoutMs = 10_000,
) {
  return api(
    ctx.opencodeUrl,
    ctx.token,
    `/session/${id}/message`,
    {
      method: "POST",
      body: JSON.stringify({
        model: { providerID, modelID },
        parts: [{ type: "text", text }],
      }),
    },
    timeoutMs,
  )
}

async function sendMessageWithRetry(
  ctx: Sandbox,
  id: string,
  providerID: string,
  modelID: string,
  text: string,
  timeoutMs = 20_000,
  attempts = 3,
): Promise<ApiResponse> {
  const sent = await sendMessage(ctx, id, providerID, modelID, text, timeoutMs)
  if (sent.status === 200 || attempts <= 1) return sent
  await sleep(500)
  return sendMessageWithRetry(ctx, id, providerID, modelID, text, timeoutMs, attempts - 1)
}

async function waitForAssistantText(ctx: Sandbox, id: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  let text = ""
  while (Date.now() < deadline) {
    const messages = await api(ctx.opencodeUrl, ctx.token, `/session/${id}/message`, {}, 6_000)
    if (messages.status === 200) {
      text = assistantText(messages.body)
      if (text.length > 0) return text
    }
    await sleep(150)
  }
  return text
}

function anthropicSse(text: string): string {
  const id = `msg_${Date.now()}`
  const event = (name: string, data: unknown) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`
  let out = ""
  out += event("message_start", {
    type: "message_start",
    message: {
      id,
      type: "message",
      role: "assistant",
      content: [],
      model: "claude-sonnet-4-5-20250929",
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 0 },
    },
  })
  out += event("content_block_start", {
    type: "content_block_start",
    index: 0,
    content_block: { type: "text", text: "" },
  })
  out += event("content_block_delta", {
    type: "content_block_delta",
    index: 0,
    delta: { type: "text_delta", text },
  })
  out += event("content_block_stop", { type: "content_block_stop", index: 0 })
  out += event("message_delta", {
    type: "message_delta",
    delta: { stop_reason: "end_turn", stop_sequence: null },
    usage: { output_tokens: text.length },
  })
  out += event("message_stop", { type: "message_stop" })
  return out
}

function openaiSse(text: string, modelID: string): string {
  const responseID = `resp_${Date.now()}`
  const messageID = `msg_${Date.now()}`
  const data = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`
  let out = ""
  out += data({
    type: "response.created",
    response: {
      id: responseID,
      object: "response",
      created_at: Math.floor(Date.now() / 1000),
      status: "in_progress",
      model: modelID,
      output: [],
    },
  })
  out += data({
    type: "response.output_item.added",
    response_id: responseID,
    output_index: 0,
    item: { id: messageID, type: "message", role: "assistant", content: [] },
  })
  out += data({
    type: "response.content_part.added",
    response_id: responseID,
    item_id: messageID,
    output_index: 0,
    content_index: 0,
    part: { type: "output_text", text: "", annotations: [] },
  })
  out += data({
    type: "response.output_text.delta",
    response_id: responseID,
    item_id: messageID,
    output_index: 0,
    content_index: 0,
    delta: text,
  })
  out += data({
    type: "response.output_text.done",
    response_id: responseID,
    item_id: messageID,
    output_index: 0,
    content_index: 0,
    text,
  })
  out += data({
    type: "response.content_part.done",
    response_id: responseID,
    item_id: messageID,
    output_index: 0,
    content_index: 0,
    part: { type: "output_text", text, annotations: [] },
  })
  out += data({
    type: "response.output_item.done",
    response_id: responseID,
    output_index: 0,
    item: {
      id: messageID,
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text, annotations: [] }],
    },
  })
  out += data({
    type: "response.completed",
    response: {
      id: responseID,
      object: "response",
      created_at: Math.floor(Date.now() / 1000),
      status: "completed",
      model: modelID,
      output: [
        {
          id: messageID,
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text, annotations: [] }],
        },
      ],
      output_text: text,
    },
  })
  out += "data: [DONE]\\n\\n"
  return out
}

function decodeRequestBody(
  headers: Record<string, string | string[] | undefined>,
  raw: Buffer,
) {
  const header = headers["content-encoding"]
  const encoding = (Array.isArray(header) ? header.join(",") : header || "")
    .toLowerCase()
    .trim()
  if (encoding.length === 0 || encoding === "identity") return raw.toString("utf8")
  try {
    if (encoding.includes("zstd")) return zstdDecompressSync(raw).toString("utf8")
    if (encoding.includes("gzip")) return gunzipSync(raw).toString("utf8")
    if (encoding.includes("deflate")) return inflateSync(raw).toString("utf8")
    if (encoding.includes("br")) return brotliDecompressSync(raw).toString("utf8")
    return raw.toString("utf8")
  } catch {
    return raw.toString("utf8")
  }
}

function isAnthropicRequest(value: unknown) {
  const body = asRecord(value)
  if (!body) return false
  return typeof body.model === "string" && Array.isArray(body.messages)
}

function isOpenAIResponsesRequest(value: unknown) {
  const body = asRecord(value)
  if (!body) return false
  return typeof body.model === "string" && Array.isArray(body.input) && body.stream === true
}

async function startClaudeShim(text: string) {
  const hits: Hit[] = []
  let invalid = 0
  const port = await freePort()
  const server = createHttpServer((req, res) => {
    const chunks: Buffer[] = []
    req.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
    req.on("end", () => {
      const bodyText = decodeRequestBody(req.headers, Buffer.concat(chunks))
      hits.push({ method: req.method || "", url: req.url || "", body: bodyText })
      const path = (req.url || "").split("?")[0]

      if (req.method === "POST" && path.endsWith("/count_tokens")) {
        res.writeHead(200, { "content-type": "application/json" })
        res.end(JSON.stringify({ input_tokens: 10 }))
        return
      }

      if (req.method === "POST" && path.endsWith("/messages")) {
        let body = null
        try {
          body = bodyText.length > 0 ? JSON.parse(bodyText) : null
        } catch {
          body = null
        }
        if (!isAnthropicRequest(body)) {
          invalid += 1
          res.writeHead(400, { "content-type": "application/json" })
          res.end(JSON.stringify({ error: "invalid anthropic request shape" }))
          return
        }

        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        })
        res.end(anthropicSse(text))
        return
      }

      res.writeHead(404, { "content-type": "application/json" })
      res.end(JSON.stringify({ error: `unknown route ${req.method} ${req.url}` }))
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.on("error", reject)
    server.listen(port, "127.0.0.1", () => resolve())
  })

  return {
    hits,
    getInvalid: () => invalid,
    env: {
      ANTHROPIC_API_KEY: "sk-ant-test",
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
      ANTHROPIC_API_BASE: `http://127.0.0.1:${port}`,
    },
    dispose: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
      }),
  }
}

async function startCodexShim(text: string) {
  const hits: Hit[] = []
  let invalid = 0
  const port = await freePort()
  const server = createHttpServer((req, res) => {
    const chunks: Buffer[] = []
    req.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
    req.on("end", () => {
      const bodyText = decodeRequestBody(req.headers, Buffer.concat(chunks))
      hits.push({ method: req.method || "", url: req.url || "", body: bodyText })
      const path = (req.url || "").split("?")[0]
      if (req.method !== "POST" || !path.endsWith("/responses")) {
        res.writeHead(404, { "content-type": "application/json" })
        res.end(JSON.stringify({ error: `unknown route ${req.method} ${req.url}` }))
        return
      }

      let body = null
      try {
        body = bodyText.length > 0 ? JSON.parse(bodyText) : null
      } catch {
        body = null
      }

      if (!isOpenAIResponsesRequest(body)) {
        invalid += 1
        res.writeHead(400, { "content-type": "application/json" })
        res.end(JSON.stringify({ error: "invalid openai responses request shape" }))
        return
      }

      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      })
      res.end(openaiSse(text, body.model))
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.on("error", reject)
    server.listen(port, "127.0.0.1", () => resolve())
  })

  return {
    hits,
    getInvalid: () => invalid,
    env: {
      OPENAI_API_KEY: "sk-openai-test",
      OPENAI_BASE_URL: `http://127.0.0.1:${port}`,
    },
    dispose: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
      }),
  }
}

async function startConnectProxy() {
  const connects: string[] = []
  const port = await freePort()
  const server = createHttpServer()

  server.on("connect", (req, clientSocket, head) => {
    const target = req.url || ""
    connects.push(target)
    const split = target.split(":")
    const host = split[0] || ""
    const portValue = Number(split[1] || "443")
    const upstream = createConnection({ host, port: portValue }, () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\\r\\n\\r\\n")
      if (head.length > 0) upstream.write(head)
      clientSocket.pipe(upstream)
      upstream.pipe(clientSocket)
    })
    upstream.on("error", () => {
      clientSocket.end()
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.on("error", reject)
    server.listen(port, "127.0.0.1", () => resolve())
  })

  return {
    connects,
    env: {
      ANTHROPIC_API_KEY: "sk-ant-test",
      HTTPS_PROXY: `http://127.0.0.1:${port}`,
      HTTP_PROXY: `http://127.0.0.1:${port}`,
    },
    dispose: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
      }),
  }
}

function parseAgents(value: unknown): AgentEntry[] {
  const body = asRecord(value)
  const agents = body?.agents
  if (!Array.isArray(agents)) return []
  return agents
    .map((item) => {
      const record = asRecord(item)
      if (!record) return null
      if (typeof record.id !== "string") return null
      return {
        id: record.id,
        installed: record.installed === true,
        credentialsAvailable: record.credentialsAvailable === true,
      }
    })
    .filter((item): item is AgentEntry => item !== null)
}

function parseProviders(value: unknown): ProviderPayload {
  const body = asRecord(value)
  const allValue = Array.isArray(body?.all) ? body.all : []
  const defaultValue = asRecord(body?.default) || {}

  const all = allValue
    .map((item) => {
      const record = asRecord(item)
      if (!record || typeof record.id !== "string") return null
      return {
        id: record.id,
        models: asRecord(record.models) || {},
      }
    })
    .filter((item): item is { id: string; models?: Record<string, unknown> } => item !== null)

  const fallback: Record<string, string> = {}
  for (const [key, raw] of Object.entries(defaultValue)) {
    if (typeof raw === "string") fallback[key] = raw
  }
  return { all, default: fallback }
}

function modelForProvider(payload: ProviderPayload, providerID: string) {
  const provider = payload.all.find((item) => item.id === providerID)
  if (!provider) return ""
  const ids = Object.keys(provider.models || {})
  if (ids.includes("default")) return "default"
  return ids[0] || ""
}

async function installAgent(ctx: Sandbox, id: RequestedAgent) {
  const installed = await api(
    ctx.rootUrl,
    ctx.token,
    `/v1/agents/${id}/install`,
    { method: "POST", body: "{}" },
    120_000,
  )
  expect(installed.status).toBe(200)
}

function modelFromFirstUserMessage(value: unknown): { providerID: string; modelID: string } | null {
  if (!Array.isArray(value)) return null
  for (const item of value) {
    const message = asRecord(item)
    if (!message) continue
    const info = asRecord(message.info)
    if (!info || info.role !== "user") continue
    const model = asRecord(info.model)
    if (!model) return null
    if (typeof model.providerID !== "string" || typeof model.modelID !== "string") return null
    return { providerID: model.providerID, modelID: model.modelID }
  }
  return null
}

describe("sandbox-agent opencode compat real E2E (self-documenting)", () => {
  afterEach(async () => {
    if (sandboxClient) {
      await sandboxClient.dispose().catch(() => {})
      sandboxClient = null
    }
  })

  afterAll(async () => {
    if (sandboxClient) {
      await sandboxClient.dispose().catch(() => {})
      sandboxClient = null
    }
    delete process.env.SANDBOX_AGENT_PORT
    delete process.env.SANDBOX_AGENT_TOKEN
    delete process.env.SANDBOX_AGENT_MODULE_PATH
  })

  it("smoke: each core agent serves /opencode/agent", async () => {
    let baseline = ""
    for (const [index, agent] of coreAgents.entries()) {
      await withSandbox(agent, {}, async (ctx) => {
        const res = await api(ctx.opencodeUrl, ctx.token, "/agent", {}, 12_000)
        expect(res.status).toBe(200)
        expect(res.text.length).toBeGreaterThan(0)
        if (index === 0) baseline = res.text
        if (index > 0) expect(res.text).toBe(baseline)
      })
    }
  }, 90_000)

  it("required agents are exposed and runnable (including cursor and pi)", async () => {
    await withSandbox(
      "opencode",
      { ANTHROPIC_API_KEY: "x", OPENAI_API_KEY: "x", CODEX_API_KEY: "x" },
      async (ctx) => {
        const agentsRes = await api(ctx.rootUrl, ctx.token, "/v1/agents", {}, 12_000)
        expect(agentsRes.status).toBe(200)
        const agents = parseAgents(agentsRes.body)

        for (const id of requestedAgents) {
          const entry = agents.find((agent) => agent.id === id)
          expect(entry).toBeDefined()
          if (!entry?.installed) await installAgent(ctx, id)
        }

        const refreshed = await api(ctx.rootUrl, ctx.token, "/v1/agents", {}, 12_000)
        expect(refreshed.status).toBe(200)
        const installed = parseAgents(refreshed.body)

        for (const id of requestedAgents) {
          const entry = installed.find((agent) => agent.id === id)
          expect(entry).toBeDefined()
          expect(entry?.installed).toBe(true)
          expect(entry?.credentialsAvailable).toBe(true)
        }
      },
    )
  }, 90_000)

  it("claude: one real message exchange through local Anthropic-compatible shim", async () => {
    const shim = await startClaudeShim("OK-CLAUDE")
    try {
      await withSandbox("claude", shim.env, async (ctx) => {
        await installAgent(ctx, "claude")
        const id = await createSession(ctx, "claude-turn")
        const sent = await sendMessageWithRetry(
          ctx,
          id,
          model.claude.providerID,
          model.claude.modelID,
          "Reply with exactly OK-CLAUDE",
        )
        expect(sent.status).toBe(200)
        const text = await waitForAssistantText(ctx, id, 20_000)
        expect(text).toContain("OK-CLAUDE")
      })

      expect(shim.getInvalid()).toBe(0)
      expect(shim.hits.some((hit) => hit.url.includes("/v1/messages"))).toBe(true)
    } finally {
      await shim.dispose()
    }
  }, 60_000)

  it("codex: one real message exchange through local OpenAI Responses shim", async () => {
    const shim = await startCodexShim("OK-CODEX")
    try {
      await withSandbox("codex", shim.env, async (ctx) => {
        await installAgent(ctx, "codex")
        const id = await createSession(ctx, "codex-turn")
        const sent = await sendMessageWithRetry(
          ctx,
          id,
          model.codex.providerID,
          model.codex.modelID,
          "Reply with exactly OK-CODEX",
        )
        expect(sent.status).toBe(200)
        const text = await waitForAssistantText(ctx, id, 20_000)
        expect(text).toContain("OK-CODEX")
      })

      expect(shim.getInvalid()).toBe(0)
      expect(shim.hits.some((hit) => hit.url.endsWith("/responses"))).toBe(true)
      expect(shim.hits.some((hit) => hit.body.includes('"stream":true'))).toBe(true)
    } finally {
      await shim.dispose()
    }
  }, 60_000)

  it("amp: proves real outbound provider dial-out via CONNECT proxy", async () => {
    const proxy = await startConnectProxy()
    try {
      await withSandbox("amp", proxy.env, async (ctx) => {
        await installAgent(ctx, "amp")
        const providerRes = await api(ctx.opencodeUrl, ctx.token, "/provider", {}, 12_000)
        expect(providerRes.status).toBe(200)
        const providers = parseProviders(providerRes.body)
        const ampModel = modelForProvider(providers, "amp")
        expect(ampModel.length).toBeGreaterThan(0)

        proxy.connects.splice(0, proxy.connects.length)

        const id = await createSession(ctx, "amp-turn")
        await sendMessageWithRetry(
          ctx,
          id,
          "amp",
          ampModel,
          "Reply with exactly OK-AMP",
          20_000,
          2,
        )
        await sleep(1000)
      })

      expect(proxy.connects.length).toBeGreaterThan(0)
    } finally {
      await proxy.dispose()
    }
  }, 60_000)

  it("cursor and pi route-selection does not silently fall back to mock", async () => {
    await withSandbox(
      "opencode",
      { ANTHROPIC_API_KEY: "x", OPENAI_API_KEY: "x", CODEX_API_KEY: "x" },
      async (ctx) => {
        await installAgent(ctx, "cursor")
        await installAgent(ctx, "pi")

        const providerRes = await api(ctx.opencodeUrl, ctx.token, "/provider", {}, 12_000)
        expect(providerRes.status).toBe(200)
        const providers = parseProviders(providerRes.body)

        for (const id of ["cursor", "pi"] as const) {
          // If provider catalog doesn't expose these, this assertion fails and
          // captures that full agent compatibility is not yet wired.
          expect(providers.all.some((item) => item.id === id)).toBe(true)

          const modelID = modelForProvider(providers, id)
          expect(modelID.length).toBeGreaterThan(0)

          const session = await createSession(ctx, `${id}-probe`)
          const sent = await sendMessageWithRetry(
            ctx,
            session,
            id,
            modelID,
            `Reply with OK-${id}`,
            20_000,
            2,
          )
          expect(sent.status).toBe(200)

          const messages = await api(ctx.opencodeUrl, ctx.token, `/session/${session}/message`, {}, 12_000)
          expect(messages.status).toBe(200)
          const selected = modelFromFirstUserMessage(messages.body)
          expect(selected).toEqual({ providerID: id, modelID })
        }
      },
    )
  }, 90_000)
})
