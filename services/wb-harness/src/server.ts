import type { WBConfig } from "./config"
import { handleChatCompletions, readChatRequest } from "./openai"
import { buildPrompt, enrich } from "./tools/enrich"
import { listTools } from "./tools/registry"
import { buildWBHeaders, buildWBRequest, WBError } from "./wb/client"

export type HarnessState = {
  startedAt: number
  lastRequest?: {
    at: string
    source: "openai" | "wb"
    text: string
    tools: string[]
    scenario?: string
  }
}

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization, x-wb-session, x-userdata",
}

export function createHarness(config: WBConfig, state: HarnessState) {
  return async function fetch(request: Request): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders })

    const url = new URL(request.url)

    try {
      if (url.pathname === "/health" && request.method === "GET") {
        return json({
          status: "ok",
          service: "wb-harness",
          uptime: Math.round((Date.now() - state.startedAt) / 1000),
          auth: {
            configured: Boolean(config.auth.token && config.auth.userdata),
            source: config.auth.source,
            expiresAt: config.auth.expiresAt,
          },
          enrichment: config.enrichment.enabled,
          tools: listTools().map((tool) => tool.name),
        })
      }

      if (url.pathname === "/v1/models" && request.method === "GET") {
        return json({
          object: "list",
          data: [
            { id: "wb-agent", object: "model", owned_by: "wildberries", created: 0 },
          ],
        })
      }

      if (url.pathname === "/v1/chat/completions" && request.method === "POST") {
        if (!hasAuth(config)) return authError()
        const payload = readChatRequest(await safeJson(request))
        if (!payload) return json({ error: { message: "invalid request body" } }, 400)

        const result = await handleChatCompletions(
          { ...payload, session_id: request.headers.get("x-wb-session") ?? payload.session_id },
          config,
          request.signal,
        )
        state.lastRequest = {
          at: new Date().toISOString(),
          source: "openai",
          text: payload.messages.at(-1)?.content ?? "",
          tools: extractTools(result),
        }
        return withCors(result)
      }

      if (url.pathname === "/api/chat/v5/message" && request.method === "POST") {
        if (!hasAuth(config)) return authError()
        return proxyWBMessage(request, config, state)
      }

      if (url.pathname === "/debug/last" && request.method === "GET") {
        return json({ last: state.lastRequest ?? null })
      }

      return json({ error: { message: "not found" } }, 404)
    } catch (error) {
      if (error instanceof WBError) {
        return withCors({
          status: error.status,
          headers: error.retryAfterSeconds
            ? { "retry-after": String(error.retryAfterSeconds) }
            : undefined,
          body: {
            error: {
              message:
                error.status === 401
                  ? "Wildberries rejected the credentials (WB_TOKEN/WB_USERDATA)"
                  : error.message,
              retry_after: error.retryAfterSeconds,
              upstream: error.body.slice(0, 500),
            },
          },
        })
      }
      return json({ error: { message: error instanceof Error ? error.message : "internal error" } }, 500)
    }
  }
}

async function proxyWBMessage(request: Request, config: WBConfig, state: HarnessState): Promise<Response> {
  const body = await safeJson(request)
  if (typeof body !== "object" || body === null) return json({ error: "invalid body" }, 400)

  const payload = body as Record<string, unknown>
  const text = typeof payload.text === "string" ? payload.text.trim() : ""
  if (!text) {
    return json({ error: "BAD_REQUEST", message: "text is required" }, 400)
  }

  const enrichment = config.enrichment.enabled
    ? await enrich(text, config.enrichment.timeoutMs)
    : { tools: [], results: [], context: "" }

  const upstream = await fetch(config.upstream, {
    method: "POST",
    headers: buildWBHeaders(config.auth),
    body: JSON.stringify(
      buildWBRequest({
        text: buildPrompt(text, enrichment),
        sessionID: typeof payload.session_id === "string" ? payload.session_id : undefined,
        idempotencyKey:
          typeof payload.idempotency_key === "string" ? payload.idempotency_key : undefined,
        auth: config.auth,
        upstream: config.upstream,
      }),
    ),
    signal: request.signal,
  })

  state.lastRequest = {
    at: new Date().toISOString(),
    source: "wb",
    text,
    tools: enrichment.tools,
  }

  if (!upstream.ok || !upstream.body) {
    const detail = (await upstream.text()).slice(0, 500)
    const retryAfter = upstream.headers.get("retry-after")
    return new Response(
      JSON.stringify({ error: upstream.statusText, status: upstream.status, upstream: detail }),
      {
        status: upstream.status,
        headers: {
          ...corsHeaders,
          "content-type": "application/json; charset=utf-8",
          ...(retryAfter ? { "retry-after": retryAfter } : {}),
        },
      },
    )
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      ...corsHeaders,
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      "x-harness-tools": enrichment.tools.join(","),
    },
  })
}

function hasAuth(config: WBConfig): boolean {
  return Boolean(config.auth.token && config.auth.userdata)
}

function authError() {
  return json(
    {
      error: {
        message:
          "WB_TOKEN and WB_USERDATA are not set. Copy them from the wildberries.ru request headers.",
      },
    },
    401,
  )
}

function extractTools(result: { body: unknown }): string[] {
  if (typeof result.body !== "object" || result.body === null) return []
  const harness = (result.body as Record<string, unknown>).wb_harness
  if (typeof harness !== "object" || harness === null) return []
  const tools = (harness as Record<string, unknown>).tools
  return Array.isArray(tools) ? tools.filter((tool): tool is string => typeof tool === "string") : []
}

async function safeJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json; charset=utf-8" },
  })
}

function withCors(result: { status: number; body: unknown; headers?: Record<string, string> }) {
  if (result.body instanceof ReadableStream) {
    return new Response(result.body, {
      status: result.status,
      headers: { ...corsHeaders, "content-type": "text/event-stream; charset=utf-8", ...result.headers },
    })
  }
  return json(result.body, result.status)
}
