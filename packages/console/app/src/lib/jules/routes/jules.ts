import * as client from "../client/JulesClient"
import * as cfg from "../config"
import { JulesAuthError } from "../client/errors"

const JSON_HEADERS = { "Content-Type": "application/json" }

function auth(request: Request): string | Response {
  const k = cfg.key(request)
  if (!k)
    return new Response(JSON.stringify({ error: "Missing " + cfg.JULES_HEADER + " header" }), {
      status: 401,
      headers: JSON_HEADERS,
    })
  return k
}

function respond(result: { ok: boolean; data?: unknown; error?: unknown }): Response {
  if (result.ok) return new Response(JSON.stringify(result.data), { status: 200, headers: JSON_HEADERS })
  const err = result.error
  if (err instanceof JulesAuthError)
    return new Response(JSON.stringify({ error: err.message }), { status: 401, headers: JSON_HEADERS })
  const status = (err as { status?: number }).status ?? 502
  const message = (err as { message?: string }).message ?? "Unknown error"
  return new Response(JSON.stringify({ error: message }), { status, headers: JSON_HEADERS })
}

export async function sessions(request: Request): Promise<Response> {
  const k = auth(request)
  if (k instanceof Response) return k
  const body = await request.json()
  const result = await client.create(k, body)
  return respond(result)
}

export async function session(request: Request, id: string): Promise<Response> {
  const k = auth(request)
  if (k instanceof Response) return k
  const result = await client.get(k, id)
  return respond(result)
}

export async function activities(request: Request, id: string): Promise<Response> {
  const k = auth(request)
  if (k instanceof Response) return k
  const result = await client.activities(k, id)
  return respond(result)
}

export async function approve(request: Request, id: string): Promise<Response> {
  const k = auth(request)
  if (k instanceof Response) return k
  const result = await client.approve(k, id)
  return respond(result)
}

export async function reject(request: Request, id: string): Promise<Response> {
  const k = auth(request)
  if (k instanceof Response) return k
  const body = await request.json()
  const feedback = (body as { feedback?: string }).feedback ?? ""
  const result = await client.reject(k, id, feedback)
  return respond(result)
}

export async function cancel(request: Request, id: string): Promise<Response> {
  const k = auth(request)
  if (k instanceof Response) return k
  const result = await client.cancel(k, id)
  return respond(result)
}

export async function sources(request: Request): Promise<Response> {
  const k = auth(request)
  if (k instanceof Response) return k
  const result = await client.sources(k)
  return respond(result)
}
