import type { EaLabService } from "./ea-lab-service"

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"])

export function startEaLabHttpServer(input: { service: EaLabService; hostname?: string; port?: number }) {
  const hostname = input.hostname ?? process.env.OPENCODE_EA_LAB_SERVICE_HOST ?? "127.0.0.1"
  requireToken(hostname)
  return Bun.serve({
    hostname,
    port: input.port ?? Number(process.env.OPENCODE_EA_LAB_SERVICE_PORT ?? 17642),
    async fetch(request) {
      const unauthorized = authorize(request)
      if (unauthorized) return unauthorized
      const url = new URL(request.url)
      if (request.method === "GET" && url.pathname === "/health") return json(await input.service.health())
      return json({ error: "not found" }, 404)
    },
  })
}

function authorize(request: Request) {
  const expected = process.env.OPENCODE_EA_LAB_SERVICE_TOKEN?.trim()
  if (!expected) return
  if (request.headers.get("authorization") === `Bearer ${expected}`) return
  return json({ error: "unauthorized" }, 401)
}

function requireToken(hostname: string) {
  if (LOCAL_HOSTS.has(hostname) && process.env.OPENCODE_EA_LAB_ALLOW_UNAUTH_LOCALHOST === "true") return
  if (process.env.OPENCODE_EA_LAB_SERVICE_TOKEN?.trim()) return
  throw new Error("OPENCODE_EA_LAB_SERVICE_TOKEN is required; set OPENCODE_EA_LAB_ALLOW_UNAUTH_LOCALHOST=true only for local tests")
}

function json(input: unknown, status = 200) {
  return new Response(JSON.stringify(input), {
    status,
    headers: { "content-type": "application/json" },
  })
}
