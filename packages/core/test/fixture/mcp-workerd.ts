import { McpCooldown } from "@opencode/core/mcp/cooldown"

export default {
  async fetch(request: Request) {
    const timer = globalThis.setInterval(() => {}, 60_000)
    const globalTimerType = typeof timer
    globalThis.clearInterval(timer)
    const url = new URL(request.url)
    const send = McpCooldown.wrap(url, url, fetch)
    const first = await send(url)
    const second = await send(url)
    return Response.json({
      globalTimerType,
      firstStatus: first.status,
      firstBody: await first.text(),
      firstRetryAfter: first.headers.get("retry-after"),
      secondStatus: second.status,
      secondBody: await second.text(),
    })
  },
}
