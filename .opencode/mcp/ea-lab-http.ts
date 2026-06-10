import type { EaLabService } from "./ea-lab-service"

export function startEaLabHttpServer(input: { service: EaLabService; port?: number }) {
  return Bun.serve({
    port: input.port ?? Number(process.env.OPENCODE_EA_LAB_SERVICE_PORT ?? 17642),
    async fetch(request) {
      const url = new URL(request.url)
      if (request.method === "GET" && url.pathname === "/health") return json(await input.service.health())
      return json({ error: "not found" }, 404)
    },
  })
}

function json(input: unknown, status = 200) {
  return new Response(JSON.stringify(input), {
    status,
    headers: { "content-type": "application/json" },
  })
}
